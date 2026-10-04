// Keep the inquiry fields compatible with the Manager's Partner Leads inbox.
export function franchiseInquiry(values) {
    const name = String(values.name || '').trim();
    const phone = String(values.phone || '').trim();
    const email = String(values.email || '').trim();
    const location = String(values.location || '').trim();
    const formatInterest = String(values.formatInterest || 'undecided');
    if (name.length < 2 || name.length > 100) throw new Error('Please enter your full name.');
    if (!/^[+\d()\s-]+$/.test(phone) || !/^\d{10,15}$/.test(phone.replace(/\D/g, ''))) throw new Error('Please enter a valid contact number.');
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Please check your email address.');
    if (location.length < 2 || location.length > 160) throw new Error('Please enter your preferred location or city.');
    if (!['cart', 'kiosk', 'store', 'undecided'].includes(formatInterest)) throw new Error('Please choose a franchise format.');
    if (values.consent !== true) throw new Error('Please confirm that our team may contact you about your inquiry.');
    return {name, phone, email: email || 'N/A', location, formatInterest, status: 'Pending'};
}
