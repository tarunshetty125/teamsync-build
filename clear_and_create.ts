import { connectToMongoDB, getLicensesCollection, disconnectFromMongoDB } from './backend/src/db/mongodb';
import { generateLicenseKey, hashLicenseKey } from './backend/src/licensing/services/LicenseService';
import crypto from 'crypto';

async function main() {
    await connectToMongoDB();
    console.log("Connected to MongoDB.");
    
    // Clear collections
    const collections = ['sessions', 'licenseverify', 'teamsync_usage', 'entitlements', 'trials', 'auth_sessions', 'users', 'devices', 'licenses'];
    const { client } = await import('./backend/src/db/mongodb').then(m => m as any);
    const db = (await connectToMongoDB() as any).db('natively');
    
    for (const col of collections) {
        try {
            await db.collection(col).deleteMany({});
            console.log(`Cleared ${col}`);
        } catch (e) {
            console.error(`Failed to clear ${col}`);
        }
    }
    
    // Create new pro_plus license
    const rawKey = generateLicenseKey();
    const keyHash = hashLicenseKey(rawKey);
    const licenseId = `lic_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    
    await getLicensesCollection().insertOne({
        licenseId,
        licenseKeyHash: keyHash,
        userId: `user_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
        plan: 'pro_plus' as any,
        status: 'active' as any,
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
    
    await disconnectFromMongoDB();
}

main().catch(console.error);
