import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import appIcon from './icon.png';

interface StartupSequenceProps {
    onComplete: () => void;
    isReady: boolean;
}

const StartupSequence: React.FC<StartupSequenceProps> = ({ onComplete, isReady }) => {
    const [minDurationElapsed, setMinDurationElapsed] = useState(false);
    const hasCompletedRef = useRef(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setMinDurationElapsed(true);
        }, 2200);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (isReady && minDurationElapsed && !hasCompletedRef.current) {
            hasCompletedRef.current = true;
            onComplete();
        }
    }, [isReady, minDurationElapsed, onComplete]);

    return (
        <motion.div
            key="startup"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.02, transition: { duration: 0.4, ease: [0.77, 0, 0.175, 1] } }}
            className="fixed inset-0 z-[100] bg-[#000000] flex items-center justify-center overflow-hidden"
        >
            {/* Volumetric Backlight - Adds depth/atmosphere */}
            <motion.div
                className="absolute w-96 h-96 bg-white/10 rounded-full blur-[120px]"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1.2 }}
                transition={{ duration: 3, ease: "easeOut" }}
            />

            <motion.img
                src={appIcon}
                alt="App Icon"
                className="w-24 h-24 object-contain relative z-10"
                initial={{
                    opacity: 0,
                    scale: 0.5,
                    filter: 'grayscale(1) brightness(0.4) drop-shadow(0 0 0px rgba(255,255,255,0))'
                }}
                animate={{
                    opacity: 1,
                    scale: 1,
                    filter: [
                        'grayscale(1) brightness(0.4) drop-shadow(0 0 0px rgba(255,255,255,0))',
                        'grayscale(1) brightness(0.4) drop-shadow(0 0 0px rgba(255,255,255,0))',
                        'grayscale(0) brightness(1) drop-shadow(0 0 20px rgba(255,255,255,0.3))'
                    ]
                }}
                transition={{
                    opacity: { duration: 0.6, ease: "easeOut" },
                    scale: { duration: 1.8, ease: [0.16, 1, 0.3, 1] },
                    filter: { times: [0, 0.25, 1], duration: 1.8, ease: "easeInOut" }
                }}
            />
        </motion.div>
    );
};

export default StartupSequence;
