const panels=['personal','employment','contact','pay','documents','security'];

export function serviceLength(date,now=new Date()){
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
    const start=new Date(date+'T00:00:00Z');
    if(!Number.isFinite(+start)||start.toISOString().slice(0,10)!==date)return '';
    const today=new Date(+now+8*3600000);
    if(date>today.toISOString().slice(0,10))return '';
    const elapsed=(today.getUTCFullYear()-start.getUTCFullYear())*12+today.getUTCMonth()-start.getUTCMonth()-(today.getUTCDate()<start.getUTCDate()?1:0);
    if(elapsed<1)return 'Less than a month';
    const years=Math.floor(elapsed/12),months=elapsed%12;
    return [years?years+' year'+(years===1?'':'s'):'',months?months+' month'+(months===1?'':'s'):''].filter(Boolean).join(', ');
}

export function installEmployeeProfileSections(d){
    const modal=d.getElementById('profileModal');
    const buttons=Array.from(modal?.querySelectorAll?.('[data-profile-tab]')||[]);
    const sections=Array.from(modal?.querySelectorAll?.('[data-profile-panel]')||[]);
    function choose(name){
        if(!panels.includes(name))return;
        for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.profileTab===name));
        for(const section of sections)section.hidden=section.dataset.profilePanel!==name;
        const save=d.getElementById('btnSaveProfileData');
        if(save&&buttons.length)save.hidden=!['contact','pay','documents'].includes(name);
    }
    for(const button of buttons)button.addEventListener('click',()=>choose(button.dataset.profileTab));
    const ids=['staffProfileName','staffProfileAssignment','staffHomeBranch','staffHireDate','staffService','staffContractState'];
    const put=(id,text)=>{const field=d.getElementById(id);if(field)field.textContent=text;};
    return {
        clear(){for(const id of ids)put(id,'');choose('personal');},
        show(profile){
            put(ids[0],profile.cashierName||profile.fullName||'');
            put(ids[1],[profile.role,profile.branch].filter(Boolean).join(' · '));
            for(const [index,value] of [[2,profile.branch],[3,profile.dateHired],[4,serviceLength(profile.dateHired)],[5,profile.contractStatus]])
                put(ids[index],value||'Not recorded');
        }
    };
}
