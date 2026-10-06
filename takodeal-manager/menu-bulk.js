import { recipeProblems } from './recipe-integrity.js';
import {loadRecipeState, recipePlan, operationFor, saveRecipePlan} from './recipe-changes.js';
export function parseCsv(text) {
    const rows=[];let row=[],cell='',quoted=false;
    for(let index=0;index<text.length;index++) {
        const char=text[index];
        if(char==='"') { if(quoted && text[index+1]==='"'){cell+='"';index++;}else quoted=!quoted; }
        else if(char===',' && !quoted){row.push(cell);cell='';}
        else if((char==='\r'||char==='\n') && !quoted){if(char==='\r'&&text[index+1]==='\n')index++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell='';}
        else cell+=char;
    }
    if(quoted)throw Error('CSV has an unclosed quote.');
    row.push(cell);if(row.some(value=>value.trim()))rows.push(row);
    return rows;
}
export const csvCell = value => '"'+String(value ?? '').replaceAll('"','""')+'"';
const headers=['ProductID','ProductName','Category','SellingPrice','GrabPrice','FoodpandaPrice','RecipeJSON','AddonsJSON'];
export function menuCsv(menu,bom) {
    return [headers.join(','),...menu.map(item=>[item.id,item.name,item.category,item.price ?? item.basePrice ?? 0,item.grabPrice ?? item.price ?? 0,item.foodpandaPrice ?? item.price ?? 0,JSON.stringify(bom.filter(row=>row.menuItem===item.name).map(row=>({ingredientName:row.ingredientName,qty:row.qty}))),JSON.stringify(item.addons || [])].map(csvCell).join(','))].join('\r\n');
}
export function validateMenuCsv(text, inventoryNames) {
    const rows=parseCsv(text),seen=new Set(),names=new Set();
    if(!rows.length || rows[0].join(',')!==headers.join(','))throw Error('Use the Menu & Recipes CSV exported by this version.');
    return rows.slice(1).map((columns,index)=>{
        if(columns.length!==headers.length)throw Error(`Row ${index+2}: incorrect number of columns.`);
        const [id,name,category,base,grab,panda,recipeJson,addonsJson]=columns;
        if(!id || !name.trim() || !category.trim() || seen.has(id) || names.has(name.trim()))throw Error(`Row ${index+2}: missing or duplicate item identity.`);
        seen.add(id);names.add(name.trim());
        const price=Number(base),grabPrice=Number(grab),foodpandaPrice=Number(panda);
        if([base,grab,panda].some(value=>value.trim()==='') || [price,grabPrice,foodpandaPrice].some(value=>!Number.isFinite(value)||value<0))throw Error(`Row ${index+2}: invalid prices.`);
        let recipe,addons;try{recipe=JSON.parse(recipeJson);addons=JSON.parse(addonsJson);}catch{throw Error(`Row ${index+2}: recipe or add-ons JSON is invalid.`);}
        if(!Array.isArray(recipe)||!Array.isArray(addons))throw Error(`Row ${index+2}: recipes and add-ons must be lists.`);
        const problems=recipeProblems(recipe,inventoryNames);
        for(const addon of addons)if(!addon.name || !Number.isFinite(Number(addon.price)) || Number(addon.price)<0 || (addon.linkedIngredient && (!inventoryNames.has(addon.linkedIngredient) || !Number.isFinite(Number(addon.deductQty)) || Number(addon.deductQty)<=0)))problems.push('Invalid add-on: '+addon.name);
        if(problems.length)throw Error(`Row ${index+2}: ${problems.join('; ')}`);
        return {id,name:name.trim(),category:category.trim(),price,basePrice:price,grabPrice,foodpandaPrice,recipe,addons};
    });
}
export function installMenuBulk(api=window) {
    api.downloadRecipeTemplate=async()=> {
        try {
            const [menu,bom]=await Promise.all([api.fetchCachedCollection('menu'),api.fetchCachedCollection('bom')]);
            const url=URL.createObjectURL(new Blob([menuCsv(menu,bom)],{type:'text/csv;charset=utf-8'}));
            const link=document.createElement('a');link.href=url;link.download='Takodeal_Menu_Recipes_'+new Date().toISOString().slice(0,10)+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(error){Swal.fire('Could not export',error.message,'error');}
    };
    api.processRecipeCsvUpload=async event=> {
        const file=event.target.files[0];if(!file || api.menuBulkSaving)return;api.menuBulkSaving=true;
        try {
            const text=await file.text();
            const state=await loadRecipeState(api),snapshot=table=>({docs:Object.entries(state.documents[table]).map(([id,data])=>({id,ref:api.doc(api.db,table,id),data:()=>data,exists:()=>true}))});
            const menu=snapshot('menu'),bom=snapshot('bom'),inventory=snapshot('inventory');
            const rows=validateMenuCsv(text,new Set(inventory.docs.map(row=>row.data().name))), writes=[];
            for(const row of rows) {
                const existing=menu.docs.find(doc=>doc.id===row.id);
                if(!existing)throw Error('Unknown product ID: '+row.id+'. Add new products using Add Menu Item.');
                if(menu.docs.some(doc=>doc.id!==row.id && doc.data().name===row.name))throw Error('Another product uses the name: '+row.name);
                const {recipe,...payload}=row;delete payload.id;writes.push({ref:existing.ref,mode:'update',data:payload});
                const old=bom.docs.filter(doc=>doc.data().menuItem===existing.data().name);
                for(const ingredient of recipe) {
                    const match=old.find(doc=>doc.data().ingredientName===ingredient.ingredientName);
                    const reference=match?.ref || api.doc(api.db,'bom','recipe-'+encodeURIComponent(row.id)+'-'+encodeURIComponent(ingredient.ingredientName));
                    if(!match && state.documents.bom[reference.id])throw Error('Recipe identity conflict. Refresh the menu.');
                    writes.push({ref:reference,mode:'set',data:{menuItem:row.name,ingredientName:ingredient.ingredientName,qty:Number(ingredient.qty)}});
                }
                for(const doc of old)if(!writes.some(write=>write.ref.path===doc.ref.path))writes.push({ref:doc.ref,mode:'delete'});
            }
            if(!rows.length)throw Error('The CSV has no menu items.');
            if(writes.length>390)throw Error('This CSV is too large for one safe update. Import fewer products at a time.');
            if(!await api.ManagerUI.confirm(`Update ${rows.length} menu items, their prices, and recipes together? Empty recipe lists clear that item’s recipe. Images and display order are retained.`))return;
            const changes=writes.map(write=>({table:write.ref.path.split('/')[0],id:write.ref.id,mode:write.mode,...(write.data?{data:write.data}:{})}));
            const plan=recipePlan(state,changes,{label:'Menu CSV import',intent:rows});
            await saveRecipePlan(api,plan,{operationId:operationFor(api,'csv',rows)});
            api.invalidateCache('menu');api.invalidateCache('bom');await api.loadMenuEditor();api.ManagerUI.notify(`${rows.length} menu items and recipes updated.`);
            api.recipeOperations?.delete('csv');
        }catch(error){Swal.fire('Import was not saved',error.message,'error');}
        finally{api.menuBulkSaving=false;event.target.value='';}
    };
    // The former uploader wrote menu.recipe one row at a time. Every upload now
    // uses the exported strict format and updates the real BOM atomically.
    api.processBulkUpload=api.processRecipeCsvUpload;
}
