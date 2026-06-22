import { LicenseResult, LicenseService } from './LicenseService';

export class LicenseManager {
    private static instance: LicenseManager;
    private readonly service: LicenseService;

    private constructor() {
        this.service = LicenseService.getInstance();
    }

    public static getInstance(): LicenseManager {
        if (!LicenseManager.instance) {
            LicenseManager.instance = new LicenseManager();
        }
        return LicenseManager.instance;
    }

    public async activateLicense(key: string): Promise<LicenseResult> {
        return this.service.activateLicense(key);
    }

    public isPremium(): boolean {
        return this.service.isProActive();
    }

    public deactivate(): void {
        this.service.deactivateLicense();
    }

    public getHardwareId(): string {
        return this.service.getHardwareId();
    }

    public onLicenseActivated(listener: () => void): () => void {
        return this.service.onLicenseActivated(listener);
    }

    public onLicenseRevoked(listener: () => void): () => void {
        return this.service.onLicenseRevoked(listener);
    }
}
