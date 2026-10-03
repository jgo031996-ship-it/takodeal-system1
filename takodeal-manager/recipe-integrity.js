// Shared checks for recipe editing and ingredient deletion. No stock is changed.
export function recipeProblems(recipe, availableNames) {
    const seen = new Set(), problems = [];
    for (const row of recipe) {
        const name = row.ingredientName;
        if (!name || !availableNames.has(name)) problems.push('Missing ingredient: ' + (name || '(blank)'));
        if (!Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0) problems.push('Invalid quantity: ' + (name || '(blank)'));
        if (seen.has(name)) problems.push('Duplicate recipe ingredient: ' + name);
        seen.add(name);
    }
    return [...new Set(problems)];
}

export function ingredientUses(names, recipes, menus, addons, mixMatch = []) {
    const uses = new Set();
    const add = (ingredient, label) => { if (names.has(ingredient)) uses.add(ingredient + ' → ' + label); };
    for (const r of recipes) add(r.ingredientName, 'recipe: ' + r.menuItem);
    for (const m of menus) {
        for (const a of m.addons || []) add(a.linkedIngredient, 'add-on: ' + m.name + ' / ' + a.name);
        for (const a of m.mixMatchConfig || []) add(a.linkedIngredient, 'flavor: ' + m.name + ' / ' + a.flavor);
        // Legacy bulk-editor recipes still count as a dependency.
        for (const r of m.recipe || []) add(r.item || r.ingredient || r.ingredientName, 'stored recipe: ' + m.name);
    }
    for (const a of addons) add(a.linkedIngredient, 'global add-on: ' + a.name);
    for (const a of mixMatch) add(a.linkedIngredient, 'global flavor: ' + a.flavor);
    return [...uses].sort();
}
