const { MongoClient } = require('mongodb');
const crypto = require('crypto');

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = 4;
  const segmentLength = 5;
  const parts = [];
  for (let s = 0; s < segments; s++) {
    let segment = '';
    for (let i = 0; i < segmentLength; i++) {
      segment += chars[crypto.randomInt(chars.length)];
    }
    parts.push(segment);
  }
  return parts.join('-');
}

function hashLicenseKey(licenseKey) {
  return crypto.createHash('sha256').update(licenseKey.trim()).digest('hex');
}

async function main() {
  const uri = 'mongodb+srv://tarunshetty256_db_user:126XQ2Ao7Mbd89X1@cluster0.vnezbeg.mongodb.net/?appName=Cluster0';
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log("Connected to MongoDB.");
    
    const db = client.db('natively');
    const collections = ['sessions', 'licenseverify', 'teamsync_usage', 'entitlements', 'trials', 'auth_sessions', 'users', 'devices', 'licenses'];
    
    for (const col of collections) {
      try {
        await db.collection(col).deleteMany({});
        console.log(`Cleared ${col}`);
      } catch (e) {
        console.error(`Failed to clear ${col}`);
      }
    }
    
    const rawKey = generateLicenseKey();
    const keyHash = hashLicenseKey(rawKey);
    const licenseId = `lic_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    
    await db.collection('licenses').insertOne({
        licenseId,
        licenseKeyHash: keyHash,
        userId: `user_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
        plan: 'pro_plus',
        status: 'active',
        subscriptionStatus: 'active',
        deviceLimit: 3,
        entitlementVersion: 1,
        createdAt: now,
        updatedAt: now,
    });
    
    console.log("\n==========================================");
    console.log("✅ Successfully created Pro Plus License!");
    console.log("==========================================");
    console.log(`License Key: ${rawKey}`);
    console.log(`License ID:  ${licenseId}`);
    console.log(`Plan:        pro_plus`);
    console.log("==========================================");
  } finally {
    await client.close();
  }
}

main().catch(console.error);
