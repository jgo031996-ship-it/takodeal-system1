export function notificationTone(message, requested) {
    if (['error','success','info','warning'].includes(requested)) return requested;
    const text=String(message);
    if (/failed|error|not saved|❌|required|must |choose |select |enter |cannot|could not|missing|insufficient|outside your|not approved|unavailable|denied|no .*found|already paid/i.test(text)) return 'error';
    return /saved|success|logged|added|updated|removed|confirmed|completed/i.test(text) ? 'success' : 'info';
}
export function clearManagerFieldError(field) {
    if (!field) return;
    field.classList.remove('manager-field-error');field.removeAttribute('aria-invalid');
    const id=field.dataset.managerErrorId;
    if(id){field.ownerDocument.getElementById(id)?.remove();const values=(field.getAttribute('aria-describedby')||'').split(' ').filter(value=>value && value!==id);if(values.length)field.setAttribute('aria-describedby',values.join(' '));else field.removeAttribute('aria-describedby');delete field.dataset.managerErrorId;}
}
export function markManagerFieldError(field,message) {
    if (!field) return;clearManagerFieldError(field);
    const doc=field.ownerDocument,note=doc.createElement('p');note.id='manager-field-error-'+Math.random().toString(36).slice(2);note.className='manager-field-error-text';note.textContent=message;
    field.classList.add('manager-field-error');field.setAttribute('aria-invalid','true');field.dataset.managerErrorId=note.id;field.setAttribute('aria-describedby',((field.getAttribute('aria-describedby')||'')+' '+note.id).trim());field.insertAdjacentElement('afterend',note);
    const clear=()=>clearManagerFieldError(field);field.addEventListener('input',clear,{once:true});field.addEventListener('change',clear,{once:true});field.focus();
}
export function initManagerDialogs() {
    const root = document.createElement('div'); root.className = 'manager-notifications'; root.setAttribute('aria-live', 'polite'); document.body.append(root);
    window.ManagerUI = {
        notify(message, options = {}) {
            const tone=notificationTone(message,options.type),field=typeof options.field==='string'?document.getElementById(options.field):options.field;
            if(tone==='error' && field)markManagerFieldError(field,message);
            const item = document.createElement('div'); item.className = 'manager-notification';item.dataset.tone=tone;item.setAttribute('role',tone==='error'?'alert':'status');
            const icon = document.createElement('span'); icon.className = 'manager-notification-icon'; icon.textContent = tone==='error'?'!':tone==='success'?'✓':tone==='warning'?'!':'i';
            const content = document.createElement('span'); content.textContent = String(message);
            const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss message'); close.onclick = () => item.remove();
            item.append(icon, content, close); root.append(item);
            while (root.children.length > 4) root.firstElementChild.remove();
            setTimeout(() => item.remove(), 12000);
        },
        async confirm(message) {
            return (await Swal.fire({ title: 'Confirm action', text: String(message), icon: 'question', showCancelButton: true, confirmButtonText: 'Continue', cancelButtonText: 'Cancel', focusCancel: true })).isConfirmed;
        },
        async prompt(message, value = '') {
            const result = await Swal.fire({ title: 'Enter details', text: String(message), input: 'text', inputValue: value ?? '', showCancelButton: true, confirmButtonText: 'Continue', cancelButtonText: 'Cancel' });
            return result.isConfirmed ? result.value : null;
        }
    };
    window.ManagerUI.clearFieldError=field=>clearManagerFieldError(typeof field==='string'?document.getElementById(field):field);
}
