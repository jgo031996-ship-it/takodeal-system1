// Existing company contract text extracted unchanged from Owner downloadContractPDF.
// Only the employee/offer values are substituted; signatures bind this version.
export const CONTRACT_VERSION='takodeal-existing-employment-20261118-v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initialContract(offer,person={}){
 return `<article style="font:14px/1.6 Arial,sans-serif;color:#173e35;background:white;padding:24px;max-width:800px;margin:auto"><h1>TAKODEÁL</h1><h2>Employment Contract</h2><p>This Agreement is executed on <b>${esc(person.signedAt||'Date of signing')}</b> between <b>TAKODEAL TAKOYAKI FOODCART</b> ("Employer") and <b>${esc(person.cashierName||'Employee')}</b> ("Employee").</p><p>Home branch: ${esc(offer.branch)}</p>
        <div style="font-size: 13px; line-height: 1.5; text-align: justify; color: #1e293b;">
            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">1. Position and Commencement</h4>
            <p style="margin: 0 0 10px 0;">The Employer hereby employs the Employee as a <b>${esc(offer.role)}</b> for Takodeal. The Employee agrees to faithfully and diligently perform duties assigned by the Employer. Employment shall commence on <b>${esc(offer.dateHired)}</b> and shall be valid for a period of six (6) months, subject to the terms and conditions of this Agreement.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">2. Work Schedule and Compensation</h4>
            <p style="margin: 0 0 10px 0;">The Employee shall receive a daily basic salary of <b>₱${Number(offer.dailyRate).toFixed(2)}</b>. The Employee is scheduled to work up to six (6) days per week, subject to operational needs. Working hours shall be determined by the Employer.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">3. Attendance, Absences and Tardiness Policy</h4>
            <p style="margin: 0 0 10px 0;">
                <b>Absences:</b> Failure to notify management before the start of the scheduled shift shall be considered an unexcused absence.<br>
                <b>Tardiness:</b> Repeated tardiness shall be subject to disciplinary action. Management reserves the right to deduct corresponding time or wages for late arrivals.<br>
                <b>Sanctions for Violations:</b> 1st Offense (Verbal Warning) • 2nd Offense (Written Warning) • 3rd Offense (1-Day Suspension) • 4th Offense (3-Day Suspension) • 5th Offense (7-Day Suspension) • 6th Offense (14-Day Suspension) • 7th Offense (Termination / Dismissal).
            </p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">4. Confidentiality Agreement</h4>
            <p style="margin: 0 0 10px 0;">The Employee agrees to keep all proprietary information strictly confidential (recipes, processes, suppliers). Disclosure to outside parties is a serious breach, making the Employee liable to pay a <b>One Million Pesos (₱1,000,000.00)</b> penalty to the Employer.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">5. Health Declaration</h4>
            <p style="margin: 0 0 10px 0;">The Employee affirms they are physically fit for a food-handling environment. The Employer is not responsible for medical expenses related to concealed critical illnesses.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">6. Notice of Resignation</h4>
            <p style="margin: 0 0 10px 0;">The Employee agrees to render a <b>30-day notice</b> prior to voluntarily resigning to avoid financial damages equivalent to the cost incurred due to the unserved notice period.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">7. Company Uniform and Property</h4>
            <p style="margin: 0 0 10px 0;">Items provided on a borrowed basis (cap, apron, t-shirt) must be cared for and returned upon resignation to avoid payroll deductions.</p>
        </div>
<div style="margin-top:32px"><p>${person.signature?`<img alt="Employee signature" style="width:280px;max-width:100%;height:100px;object-fit:contain" src="${esc(person.signature)}">`:''}</p><b>${esc(person.cashierName||'Employee')}</b><p>Employee digitally accepted ${esc(person.signedAt||'')}</p><p>Chery Ann R. Fonda — Owner / Employer</p><small>Contract version: ${CONTRACT_VERSION}</small></div></article>`;
}
