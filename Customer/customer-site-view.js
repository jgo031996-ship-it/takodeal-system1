import {customerSiteProfile, customerSiteFooter} from './customer-site-settings.js';

export function renderCustomerSiteProfile(document, data) {
    const profile = customerSiteProfile(data);
    const footer = customerSiteFooter(profile);
    document.querySelectorAll('[data-customer-site-footer]').forEach(node => {node.textContent = footer;});
    const title = document.getElementById('customerAboutTitle');
    const meta = document.getElementById('customerAboutMeta');
    const text = document.getElementById('customerAboutText');
    if (title) title.textContent = 'About ' + profile.businessName;
    if (meta) meta.textContent = footer;
    if (text) {text.textContent = profile.aboutText; text.hidden = !profile.aboutText;}
    return profile;
}
