export const ROLE_LABELS = Object.freeze({staff:'Staff',manager:'Manager',co_owner:'Co-Owner',owner:'Owner',franchise_owner:'Franchise owner'});
export const isMealType = id => ['staff_meal','manager_meal'].includes(id) || /^meal_level_[a-zA-Z0-9_-]+$/.test(id || '');
const label = (value, name) => { const result = String(value ?? '').trim(); if (!result || result.length > 80) throw Error(`${name} must contain 1–80 characters.`); return result; };
const percent = value => { if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) throw Error('Enter discount percentages between 0 and 100.'); return Number(value); };
export function validateLevels(rows) {
    if (!Array.isArray(rows) || rows.length > 20) throw Error('You can save up to 20 meal levels.');
    const ids = new Set(), names = new Set();
    return rows.map(row => {
        if (!isMealType(row.id) || ids.has(row.id)) throw Error('Meal level IDs must be unique.'); ids.add(row.id);
        const name = label(row.name,'Level name'), key = name.toLowerCase();
        if (names.has(key)) throw Error('Use a different name for each meal level.'); names.add(key);
        const roles = [...new Set(row.roles || [])];
        if (!roles.length || roles.some(role => !Object.hasOwn(ROLE_LABELS,role))) throw Error('Choose at least one valid role for each meal level.');
        return {id:row.id,name,roles,takoyakiPct:percent(row.takoyakiPct),otherPct:percent(row.otherPct),enabled:row.enabled !== false};
    });
}
export function mealLevels(settings = {}) {
    if (Array.isArray(settings.mealDiscountLevels)) return validateLevels(settings.mealDiscountLevels);
    return validateLevels([
        {id:'staff_meal',name:'Staff Meal',roles:['staff'],takoyakiPct:settings.staffMealTakoPct ?? 20,otherPct:settings.staffMealOtherPct ?? 10},
        {id:'manager_meal',name:'Manager / Owner Meal',roles:['manager','owner','franchise_owner'],takoyakiPct:settings.managerMealTakoPct ?? 100,otherPct:settings.managerMealOtherPct ?? 100}
    ]);
}
export function requireMealLevel(settings, id, role) {
    const level = mealLevels(settings).find(row => row.id === id && row.enabled);
    if (!level) throw Error('This meal level is unavailable. Reopen checkout to refresh the settings.');
    if (role && !level.roles.includes(role)) throw Error('This PIN is not allowed to use the selected meal level.');
    return level;
}
export function mealDiscount(cart, menu, level, total) {
    let cents = 0;
    for (const item of cart) {
        const name = String(item.name || item.itemName || '').toLowerCase();
        const category = String(item.category || menu?.find(row => [row.name,row.realName].some(n => String(n || '').toLowerCase() === name))?.category || '').toLowerCase();
        const rate = category.includes('takoyaki') || name.includes('takoyaki') ? level.takoyakiPct : level.otherPct;
        const amount = Number(item.lineTotalFinal);
        if (!Number.isFinite(amount) || amount < 0) throw Error('The cart contains an invalid item total.');
        cents += Math.round(amount * rate);
    }
    return Math.min(Math.round(Number(total) * 100), cents) / 100;
}
export function validateCheckoutFields(rows = []) {
    if (!Array.isArray(rows) || rows.length > 12) throw Error('You can save up to 12 checkout dropdowns.');
    const ids = new Set(), names = new Set();
    return rows.map(row => {
        if (!/^checkout_[a-zA-Z0-9_-]+$/.test(row.id) || ids.has(row.id)) throw Error('Checkout field IDs must be unique.'); ids.add(row.id);
        const name = label(row.name,'Dropdown label');
        if (names.has(name.toLowerCase())) throw Error('Use a different label for each dropdown.'); names.add(name.toLowerCase());
        if (!Array.isArray(row.options) || !row.options.length || row.options.length > 40) throw Error('Each dropdown needs 1–40 options.');
        const options = row.options.map(value => label(value,'Option'));
        if (new Set(options.map(value => value.toLowerCase())).size !== options.length) throw Error('Remove duplicate dropdown options.');
        return {id:row.id,name,options,required:row.required === true,enabled:row.enabled !== false};
    });
}
export function checkoutSelections(fields, values) {
    return validateCheckoutFields(fields).filter(field => field.enabled).flatMap(field => {
        const value = values[field.id] || '';
        if (!value && field.required) throw Error(`Choose ${field.name} before completing checkout.`);
        if (value && !field.options.includes(value)) throw Error(`Choose a valid option for ${field.name}.`);
        return value ? [{id:field.id,label:field.name,value}] : [];
    });
}
export function configurationPatch(levels, fields) {
    const mealDiscountLevels = validateLevels(levels), customCheckoutFields = validateCheckoutFields(fields);
    const staff = mealDiscountLevels.find(row => row.id === 'staff_meal'), manager = mealDiscountLevels.find(row => row.id === 'manager_meal');
    return {mealDiscountLevels,customCheckoutFields,
        ...(staff ? {staffMealTakoPct:staff.takoyakiPct,staffMealOtherPct:staff.otherPct} : {}),
        ...(manager ? {managerMealTakoPct:manager.takoyakiPct,managerMealOtherPct:manager.otherPct} : {})};
}
