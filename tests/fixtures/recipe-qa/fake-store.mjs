// Local test store only. This module imports no Firebase/network client.
export function createRecipeFixture() {
    const docs=new Map(),versions=new Map(),copy=value=>structuredClone(value);
    let loseAck=false;
    const ref=(table,id)=>({path:table+'/'+id,id});
    const snapshot=reference=>{const value=copy(docs.get(reference.path));return {id:reference.id,ref:reference,exists:()=>value!==undefined,data:()=>copy(value)};};
    const put=(path,data)=>{docs.set(path,copy(data));versions.set(path,(versions.get(path)||0)+1);};
    const api={db:{},auth:{currentUser:{uid:'local-qa-owner',email:'preview@example.test'}},sessionUser:{uid:'local-qa-owner',email:'preview@example.test',permissions:['menu','inventory']},
        collection:(_,table)=>({table}),doc:(_,table,id)=>ref(table,id),query:(table,...filters)=>({...table,filters}),where:(key,_op,value)=>({key,value}),serverTimestamp:()=>({seconds:Date.now()/1000}),
        getDocFromServer:async reference=>snapshot(reference),getDocsFromServer:async query=>({docs:[...docs.keys()].filter(path=>path.startsWith(query.table+'/') && (query.filters||[]).every(filter=>docs.get(path)[filter.key]===filter.value)).map(path=>snapshot(ref(query.table,path.slice(query.table.length+1))))}),
        runTransaction:async(_,callback)=>{
            for(let attempt=0;attempt<20;attempt++){
                const reads=new Map(),writes=[];
                const tx={get:async reference=>{if(writes.length)throw Error('Transaction read after write');reads.set(reference.path,versions.get(reference.path)||0);await Promise.resolve();return snapshot(reference);},
                    set:(reference,data)=>writes.push({reference,data}),update:(reference,data)=>writes.push({reference,data,merge:true}),delete:reference=>writes.push({reference,remove:true})};
                const result=await callback(tx);
                if([...reads].some(([path,version])=>(versions.get(path)||0)!==version))continue;
                const staged=new Map(docs);
                for(const write of writes){const path=write.reference.path;if(write.remove)staged.delete(path);else {if(write.merge && !staged.has(path))throw Error('Missing test document');staged.set(path,{...(write.merge?staged.get(path):{}),...copy(write.data)});}}
                docs.clear();for(const [path,data] of staged)docs.set(path,data);for(const write of writes)versions.set(write.reference.path,(versions.get(write.reference.path)||0)+1);
                api.onChange?.();if(loseAck && writes.length){loseAck=false;throw Error('Connection lost after commit. Retry this same save.');}return result;
            }throw Error('Too much test contention');
        },invalidateCache(){},loadMenuEditor:async()=>{}};
    put('hq_managers/qa',{email:'preview@example.test',pin:'1234',role:'Co-Owner',permissions:['menu','inventory']});
    for(const [id,name] of [['six','Takoyaki 6 Pcs'],['eight','Takoyaki 8 Pcs'],['twelve','Takoyaki 12 Pcs']])put('menu/'+id,{name,category:'Takoyaki',price:100,image:'preserved'});
    for(const [id,name,qty] of [['six','Takoyaki 6 Pcs',1],['eight','Takoyaki 8 Pcs',2],['twelve','Takoyaki 12 Pcs',3]]){
        put('bom/pack-'+id,{menuItem:name,ingredientName:'Takoyaki Box',qty});put('bom/sauce-'+id,{menuItem:name,ingredientName:'Takoyaki Sauce',qty:20});
    }
    for(const branch of ['Main Office','Maa'])for(const [id,name,uom] of [['box','Takoyaki Box','piece'],['bowl','Paper Bowl','piece'],['sauce','Takoyaki Sauce','gram']])put('inventory/'+branch+'-'+id,{name,branch,uom,currentStock:500});
    put('transactions/historical',{receiptId:'LOCAL-HISTORICAL',netTotal:100,inventoryMovements:[{ingredientName:'Takoyaki Box',quantity:1,inventoryId:'Maa-box'}]});
    const historical=copy(docs.get('transactions/historical')),stockBefore=Object.fromEntries([...docs].filter(([path])=>path.startsWith('inventory/')).map(([path,row])=>[path,row.currentStock]));
    return {api,docs,put,loseNextAck:()=>{loseAck=true;},verify:()=>({stocksUnchanged:Object.entries(stockBefore).every(([path,stock])=>docs.get(path).currentStock===stock),historicalUnchanged:JSON.stringify(docs.get('transactions/historical'))===JSON.stringify(historical),unselectedRecipeUnchanged:docs.get('bom/pack-twelve').ingredientName==='Takoyaki Box' && docs.get('bom/pack-twelve').qty===3,version:docs.get('settings/recipe_revision')?.version || 0,selectedRecipes:[docs.get('bom/pack-six'),docs.get('bom/pack-eight')]})};
}
