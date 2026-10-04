export function initManagerDialogs() {
    const root = document.createElement('div'); root.className = 'manager-notifications'; root.setAttribute('aria-live', 'polite'); document.body.append(root);
    window.ManagerUI = {
        notify(message) {
            const item = document.createElement('div'); item.className = 'manager-notification'; item.setAttribute('role', 'status');
            const icon = document.createElement('span'); icon.className = 'manager-notification-icon'; icon.textContent = /failed|error|not saved|❌/i.test(message) ? '!' : '✓';
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
}
