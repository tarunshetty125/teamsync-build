// Ported logic
use crate::audio_config::RING_BUFFER_SAMPLES;
use anyhow::Result;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::collections::VecDeque;
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use tracing::error;
use wasapi::{get_default_device, DeviceCollection, Direction, SampleType, ShareMode, WaveFormat};

struct WakerState {
    shutdown: bool,
}

pub struct SpeakerInput {
    device_id: Option<String>,
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    waker_state: Arc<Mutex<WakerState>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    actual_sample_rate: u32,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }

    pub fn data_ready_signal(&self) -> Arc<(Mutex<bool>, Condvar)> {
        self.data_ready.clone()
    }
}

// Helper to find device by ID
fn find_device_by_id(direction: &Direction, device_id: &str) -> Option<wasapi::Device> {
    let collection = DeviceCollection::new(direction).ok()?;
    let count = collection.get_nbr_devices().ok()?;

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            if let Ok(id) = device.get_id() {
                if id == device_id {
                    return Some(device);
                }
            }
        }
    }
    None
}

pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let collection =
        DeviceCollection::new(&Direction::Render).map_err(|e| anyhow::anyhow!("{}", e))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| anyhow::anyhow!("{}", e))?;
    let mut list = Vec::new();

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            let id = device.get_id().unwrap_or_default();
            let name = device.get_friendlyname().unwrap_or_default();
            if !id.is_empty() {
                list.push((id, name));
            }
        }
    }
    Ok(list)
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let device_id = device_id.filter(|id| !id.is_empty() && id != "default");
        Ok(Self { device_id })
    }

    pub fn stream(self) -> SpeakerStream {
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();

        let waker_state = Arc::new(Mutex::new(WakerState { shutdown: false }));
        let data_ready = Arc::new((Mutex::new(false), Condvar::new()));
        let (init_tx, init_rx) = mpsc::channel();

        let waker_clone = waker_state.clone();
        let data_ready_clone = data_ready.clone();
        let device_id = self.device_id;

        let capture_thread = thread::spawn(move || {
            if let Err(e) = Self::capture_audio_loop(
                producer,
                waker_clone,
                data_ready_clone,
                init_tx,
                device_id,
            ) {
                error!("[Audio:WASAPI] Capture loop failed: {}", e);
            }
        });

        let actual_sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                error!("[Audio:WASAPI] Initialization failed: {}", e);
                44100
            }
            Err(_) => {
                error!("[Audio:WASAPI] Initialization timeout (5s)");
                44100
            }
        };

        SpeakerStream {
            consumer: Some(consumer),
            waker_state,
            capture_thread: Some(capture_thread),
            actual_sample_rate,
            data_ready,
        }
    }

    fn capture_audio_loop(
        mut producer: HeapProd<f32>,
        waker_state: Arc<Mutex<WakerState>>,
        data_ready: Arc<(Mutex<bool>, Condvar)>,
        init_tx: mpsc::Sender<Result<u32>>,
        device_id: Option<String>,
    ) -> Result<()> {
        // Ensure COM is initialized on this thread (MTA).
        // The wasapi crate calls initialize_mta() internally in some paths, but
        // explicit initialization here guarantees correctness regardless of the
        // crate's internal behavior or future changes. Re-initialization with the
        // same apartment type is a no-op per the COM spec.
        println!("[Audio:WASAPI] Capture thread starting, initializing COM...");
        wasapi::initialize_mta().map_err(|e| anyhow::anyhow!("[Audio:WASAPI] COM init failed: {}", e))?;
        println!("[Audio:WASAPI] COM initialized (MTA)");

        let init_result = (|| -> Result<_> {
            let device = match device_id {
                Some(ref id) => {
                    println!("[Audio:WASAPI] Looking up device by ID: {}", id);
                    match find_device_by_id(&Direction::Render, id) {
                        Some(d) => {
                            let name = d.get_friendlyname().unwrap_or_default();
                            println!("[Audio:WASAPI] Found device: {}", name);
                            d
                        }
                        None => {
                            println!("[Audio:WASAPI] Device not found, falling back to default");
                            get_default_device(&Direction::Render)
                                .map_err(|e| anyhow::anyhow!("{}", e))
                                .expect("No default render device")
                        }
                    }
                }
                None => {
                    println!("[Audio:WASAPI] Using default render device");
                    get_default_device(&Direction::Render).map_err(|e| anyhow::anyhow!("{}", e))?
                }
            };

            let device_name = device.get_friendlyname().unwrap_or_else(|_| "<unknown>".to_string());
            let device_id_str = device.get_id().unwrap_or_else(|_| "<no-id>".to_string());
            println!("[Audio:WASAPI] Device: {} ({})", device_name, device_id_str);

            let mut audio_client = device
                .get_iaudioclient()
                .map_err(|e| anyhow::anyhow!("[Audio:WASAPI] get_iaudioclient: {}", e))?;
            let device_format = audio_client
                .get_mixformat()
                .map_err(|e| anyhow::anyhow!("[Audio:WASAPI] get_mixformat: {}", e))?;
            let actual_rate = device_format.get_samplespersec();
            println!("[Audio:WASAPI] Device sample rate: {}Hz, channels: {}", actual_rate, device_format.get_nchannels());

            let desired_format =
                WaveFormat::new(32, 32, &SampleType::Float, actual_rate as usize, 1, None);

            let (_def_time, min_time) = audio_client
                .get_periods()
                .map_err(|e| anyhow::anyhow!("[Audio:WASAPI] get_periods: {}", e))?;
            println!("[Audio:WASAPI] Buffer period: {}00ns", min_time);

            // For WASAPI loopback: device=Render, but initialize with Direction::Capture
            // This triggers AUDCLNT_STREAMFLAGS_LOOPBACK flag in wasapi
            audio_client
                .initialize_client(
                    &desired_format,
                    min_time,
                    &Direction::Capture,
                    &ShareMode::Shared,
                    true,
                )
                .map_err(|e| anyhow::anyhow!("[Audio:WASAPI] initialize_client (loopback): {}", e))?;
            println!("[Audio:WASAPI] Client initialized (loopback, shared mode)");

            let h_event = audio_client
                .set_get_eventhandle()
                .map_err(|e| anyhow::anyhow!("[Audio:WASAPI] set_get_eventhandle: {}", e))?;
            let render_client = audio_client
                .get_audiocaptureclient()
                .map_err(|e| anyhow::anyhow!("[Audio:WASAPI] get_audiocaptureclient: {}", e))?;
            audio_client
                .start_stream()
                .map_err(|e| anyhow::anyhow!("[Audio:WASAPI] start_stream: {}", e))?;
            println!("[Audio:WASAPI] Stream started successfully");

            Ok((h_event, render_client, actual_rate, audio_client))
        })();

        match init_result {
            Ok((h_event, render_client, sample_rate, audio_client)) => {
                let _ = init_tx.send(Ok(sample_rate));
                println!("[Audio:WASAPI] Entering capture loop at {}Hz", sample_rate);
                let mut timeout_count: u64 = 0;
                let mut total_samples: u64 = 0;
                loop {
                    {
                        let state = waker_state.lock().unwrap();
                        if state.shutdown {
                            println!("[Audio:WASAPI] Shutdown signal received, stopping stream");
                            let _ = audio_client.stop_stream();
                            break;
                        }
                    }

                    // Timeout is normal when no audio is playing — WASAPI loopback
                    // doesn't fire events during silence. Just continue waiting.
                    if h_event.wait_for_event(3000).is_err() {
                        timeout_count += 1;
                        if timeout_count <= 3 || timeout_count % 20 == 0 {
                            println!("[Audio:WASAPI] Event timeout #{} (silence — normal for loopback)", timeout_count);
                        }
                        continue;
                    }

                    let mut temp_queue = VecDeque::new();
                    // bytes_per_frame for 32-bit float mono = 4 bytes
                    let bytes_per_frame: usize = 4; // 32-bit float, 1 channel
                    if let Err(e) =
                        render_client.read_from_device_to_deque(bytes_per_frame, &mut temp_queue)
                    {
                        error!("[Audio:WASAPI] Failed to read audio data: {}", e);
                        continue;
                    }

                    if temp_queue.is_empty() {
                        continue;
                    }

                    let mut samples = Vec::with_capacity(temp_queue.len() / 4);
                    while temp_queue.len() >= 4 {
                        let bytes = [
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                        ];
                        let sample = f32::from_le_bytes(bytes);
                        samples.push(sample);
                    }

                    if !samples.is_empty() {
                        total_samples += samples.len() as u64;
                        if total_samples < 50000 || total_samples % 500000 == 0 {
                            println!("[Audio:WASAPI] Total samples captured: {}", total_samples);
                        }
                        let _ = producer.push_slice(&samples);

                        // Signal data ready
                        let (lock, cvar) = &*data_ready;
                        let mut ready = lock.lock().unwrap();
                        *ready = true;
                        cvar.notify_all();
                    }
                }
                println!("[Audio:WASAPI] Capture loop exited. Total samples: {}", total_samples);
            }
            Err(e) => {
                eprintln!("[Audio:WASAPI] FATAL init error: {}", e);
                let _ = init_tx.send(Err(e));
            }
        }
        Ok(())
    }
}

// Implement Drop to stop the thread
impl Drop for SpeakerStream {
    fn drop(&mut self) {
        println!("[Audio:WASAPI] SpeakerStream dropping, signaling shutdown...");
        if let Ok(mut state) = self.waker_state.lock() {
            state.shutdown = true;
        }
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
        println!("[Audio:WASAPI] SpeakerStream dropped");
    }
}

