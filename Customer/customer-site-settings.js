export const CUSTOMER_SITE_PROFILE_DOC = 'customer_site_profile';
export const DEFAULT_CUSTOMER_SITE_PROFILE = Object.freeze({
    businessName: 'TAKODEÁL', location: 'Davao City', sinceYear: 2023, aboutText: ''
});
const clean = (value, fallback, max) => typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max) : fallback;
const foundingYear = value => typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value.trim()) : NaN;
export function customerSiteProfile(data = {}) {
    const year = foundingYear(data?.sinceYear);
    return {
        businessName: clean(data?.businessName, DEFAULT_CUSTOMER_SITE_PROFILE.businessName, 80),
        location: clean(data?.location, DEFAULT_CUSTOMER_SITE_PROFILE.location, 80),
        sinceYear: Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear()
            ? year : DEFAULT_CUSTOMER_SITE_PROFILE.sinceYear,
        aboutText: clean(data?.aboutText, '', 1200)
    };
}
export function validateCustomerSiteProfile(data, currentYear = new Date().getFullYear()) {
    if (!data || typeof data.businessName !== 'string' || !data.businessName.trim() || data.businessName.trim().length > 80)
        throw Error('Enter a business name of up to 80 characters.');
    if (typeof data.location !== 'string' || !data.location.trim() || data.location.trim().length > 80)
        throw Error('Enter a location of up to 80 characters.');
    const year = foundingYear(data.sinceYear);
    if (!Number.isInteger(year) || year < 1900 || year > currentYear)
        throw Error('Enter a valid founding year.');
    if (typeof data.aboutText !== 'string' || data.aboutText.trim().length > 1200)
        throw Error('Keep the About TAKODEÁL description within 1,200 characters.');
    return {businessName: data.businessName.trim(), location: data.location.trim(), sinceYear: year, aboutText: data.aboutText.trim()};
}
export function customerSiteFooter(data) {
    const profile = customerSiteProfile(data);
    return `${profile.businessName} · ${profile.location} · Since ${profile.sinceYear}`;
}
export function branchOpeningNotice(branch) {
    return {soonToOpen: branch?.customerSoonToOpen === true,
        label: clean(branch?.customerOpeningLabel, 'Soon to open', 60)};
}
export function validateBranchOpeningNotice(data) {
    if (!data || typeof data.customerSoonToOpen !== 'boolean') throw Error('Choose whether this branch is opening soon.');
    if (typeof data.customerOpeningLabel !== 'string' || data.customerOpeningLabel.trim().length > 60)
        throw Error('Keep the opening watermark within 60 characters.');
    return {customerSoonToOpen: data.customerSoonToOpen,
        customerOpeningLabel: data.customerOpeningLabel.trim() || 'Soon to open'};
}
