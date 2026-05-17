/**
 * Centralised checkout & external URL constants.
 *
 * Change URLs here once — all files that import from this module
 * will pick up the update automatically.
 */

export const CHECKOUT_URLS = {
    /** TeamSync Pro (lifetime/yearly) */
    pro: 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA',
    /** TeamSync API — Standard tier */
    apiStandard: 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl',
    /** TeamSync API — Pro tier */
    apiPro: 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA',
    /** TeamSync API — Max tier */
    apiMax: 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf',
    /** TeamSync API — Ultra tier */
    apiUltra: 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU',
} as const;
