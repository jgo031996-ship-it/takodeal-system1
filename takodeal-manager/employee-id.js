// Employee ID generation stays on the device; photographs use their original source.
export function employeeIDDetails(read) {
    const clean = id => String(read(id) || '').trim();
    const employeeId = clean('profEmpId');
    if (!employeeId || ['Pending Generation...', 'undefined', 'null'].includes(employeeId)) {
        throw new Error('Save the employee profile first to generate an employee ID number.');
    }
    const date = clean('empDateHired');
    const hired = /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) : 'Not recorded';
    const name = clean('empFullName') || 'Staff Member';
    return {name, role:clean('empRole') || 'Service Crew', branch:clean('empBranchAssign') || 'Unassigned',
        employeeId, hired, contact:clean('empEmergencyName') || 'Not recorded', phone:clean('empEmergencyPhone') || 'Not recorded',
        blood:clean('profBloodType') || 'Not recorded', initials:name.split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase()};
}
export function employeeIDFilename(name) {
    return 'ID_Card_' + String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g,'_').slice(0,100) + '.png';
}
function bounded(work, ms, message) {
    let timer;
    return Promise.race([work, new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));
}
function loadPhoto(image, src, ms) {
    return bounded(new Promise((resolve,reject)=>{
        image.onload=()=>image.naturalWidth ? resolve(image) : reject(new Error('The employee photo is empty.'));
        image.onerror=()=>reject(new Error('The employee photo could not load. Reconnect or replace it in the employee profile.'));
        image.src=src;
        if(image.complete && image.naturalWidth) resolve(image);
    }), ms, 'The employee photo took too long to load. Reconnect and try again.').finally(()=>{image.onload=null;image.onerror=null;});
}
function fitText(element, size, min) {
    element.style.fontSize=size+'px';
    while(size>min && (element.scrollWidth>element.clientWidth || element.scrollHeight>element.clientHeight)) {
        element.style.fontSize=(--size)+'px';
    }
}
export async function generateEmployeeID({document:d=document, dialog=window.Swal, render=window.html2canvas, ImageClass=Image, timeoutMs=8000}={}) {
    const read=id=>{const nodes=d.querySelectorAll(`[id="${id}"]`);return nodes[nodes.length-1]?.value;};
    let details;
    try {details=employeeIDDetails(read);} catch(error) {return dialog.fire('Save required',error.message,'warning');}
    const template=d.getElementById('idCardTemplate');
    if(template.dataset.generating) return;
    template.dataset.generating='true';
    template.style.display='flex';
    dialog.fire({title:'Preparing employee ID',text:'Creating your download…',allowOutsideClick:false,didOpen:()=>dialog.showLoading()});
    try {
        const fields={idFrontName:details.name,idFrontRole:details.role,idFrontNo:details.employeeId,idFrontBranch:details.branch,
            idFrontHired:details.hired,idBackNotify:details.contact,idBackNum:details.phone,idBackBlood:details.blood,idFrontInitials:details.initials};
        for(const [id,value] of Object.entries(fields)) d.getElementById(id).textContent=value;
        const front=d.getElementById('idFrontPic'), initials=d.getElementById('idFrontInitials');
        front.hidden=true;front.removeAttribute('src');initials.hidden=false;
        const preview=d.getElementById('masterProfilePic');
        const src=preview?.getAttribute('src');
        if(src && !src.startsWith('data:image/svg+xml')) {
            // Load directly from the employee's existing photo, without public image proxies.
            const image=new ImageClass();image.crossOrigin='anonymous';
            await loadPhoto(image,preview.src || src,timeoutMs);
            const photo=d.createElement('canvas');
            // Crop to the printed portrait ratio so export libraries cannot stretch faces.
            const cropWidth=Math.min(image.naturalWidth,image.naturalHeight*146/172), cropHeight=cropWidth*172/146;
            photo.width=438;photo.height=516;
            photo.getContext('2d').drawImage(image,(image.naturalWidth-cropWidth)/2,(image.naturalHeight-cropHeight)/2,
                cropWidth,cropHeight,0,0,photo.width,photo.height);
            await loadPhoto(front,photo.toDataURL('image/png'),timeoutMs);
            front.hidden=false;initials.hidden=true;
        }
        await bounded(d.fonts?.ready || Promise.resolve(),timeoutMs,'The ID font could not finish loading. Please try again.');
        fitText(d.getElementById('idFrontName'),28,16);
        fitText(d.getElementById('idFrontRole'),16,12);
        fitText(d.getElementById('idFrontNo'),18,11);
        fitText(d.getElementById('idFrontBranch'),16,12);
        fitText(d.getElementById('idBackNotify'),18,12);
        const canvas=await bounded(render(template,{scale:3,backgroundColor:'#ffffff',useCORS:true,allowTaint:false,
            width:1012,height:638,logging:false}),20000,'The ID export took too long. Please try again.');
        const link=d.createElement('a');link.download=employeeIDFilename(details.name);link.href=canvas.toDataURL('image/png');link.click();
        dialog.close();
        await dialog.fire({title:'Employee ID downloaded',text:'The front and back are saved together as a high-resolution image.',icon:'success'});
    } catch(error) {
        dialog.close();await dialog.fire('ID could not be generated',error.message || 'Please try again.','error');
    } finally {template.style.display='none';delete template.dataset.generating;}
}
