import { supabase } from '../supabaseClient.js';
import { Toast } from './Toast.js';

// Same rule as public.is_weak_pin() in the database (which is the final authority)
const WEAK_PINS = ['0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876',
  '1212', '2121', '1122', '2211', '0101', '1010', '2580', '0852', '1357', '2468', '1004', '2000', '2001', '6969', '4200', '1313', '1999'];

export function isWeakPin(pin) {
  if (!/^\d{4}$/.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true;
  return WEAK_PINS.includes(pin);
}

export const PIN_HELP = 'The PIN must be 4 digits. Easy patterns are refused (1234, 0000, 1111, 2580, ...).';

// Four single-digit boxes. masked=true shows dots instead of digits.
export function pinBoxesHtml(name, { masked = false } = {}) {
  const boxes = [0, 1, 2, 3]
    .map(
      (i) => `<input class="pin-box" type="${masked ? 'password' : 'text'}" inputmode="numeric" pattern="[0-9]*"
                     maxlength="1" autocomplete="off" data-pin-index="${i}" aria-label="PIN digit ${i + 1}" />`
    )
    .join('');
  return `<div class="pin-boxes" data-pin-boxes="${name}">${boxes}</div>`;
}

// Wires up the boxes: digits only, auto-advance, backspace goes back, pasting 4 digits fills all of them.
export function bindPinBoxes(root, name) {
  const wrap = root.querySelector(`[data-pin-boxes="${name}"]`);
  if (!wrap) return null;
  const boxes = [...wrap.querySelectorAll('.pin-box')];

  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(-1);
      if (box.value && boxes[i + 1]) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && boxes[i - 1]) {
        boxes[i - 1].value = '';
        boxes[i - 1].focus();
      }
      if (e.key === 'ArrowLeft' && boxes[i - 1]) boxes[i - 1].focus();
      if (e.key === 'ArrowRight' && boxes[i + 1]) boxes[i + 1].focus();
    });
    box.addEventListener('focus', () => box.select());
    box.addEventListener('paste', (e) => {
      const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 4);
      if (!digits) return;
      e.preventDefault();
      boxes.forEach((b, j) => { b.value = digits[j] || ''; });
      (boxes[Math.min(digits.length, 3)] || boxes[3]).focus();
    });
  });

  return {
    get value() { return boxes.map((b) => b.value).join(''); },
    clear() { boxes.forEach((b) => { b.value = ''; }); },
    focus() { boxes[0].focus(); },
    setInvalid(on) { wrap.classList.toggle('invalid', !!on); },
  };
}

// =========================================================================
// First-time PIN for the signed-in person. Resolves true when they now have a PIN,
// false when they cancelled. It cannot be dismissed by clicking outside.
// =========================================================================
export function pinSetupDialog({ title = 'Create your POS PIN', intro } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML = `
      <div class="auth-card" style="max-width:420px; width:100%;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <span class="pin-dialog-icon"><i data-lucide="lock-keyhole"></i></span>
          <h3 style="font-size:1.1rem; font-weight:700; margin:0;">${title}</h3>
        </div>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:18px;">
          ${intro || 'Everyone who works here signs in to the mobile POS with a personal 4-digit PIN. Create yours before adding employees.'}
        </p>
        <form id="own-pin-form" novalidate>
          <div class="form-group">
            <label>New PIN</label>
            ${pinBoxesHtml('own-pin', { masked: true })}
          </div>
          <div class="form-group">
            <label>Confirm PIN</label>
            ${pinBoxesHtml('own-pin-confirm', { masked: true })}
          </div>
          <p id="own-pin-error" class="pin-error hidden"></p>
          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:8px;">
            <button type="button" class="btn btn-outline" id="own-pin-cancel">Not now</button>
            <button type="submit" class="btn btn-teal-primary" id="own-pin-save">Save PIN</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    if (window.lucide) window.lucide.createIcons({ root: overlay });

    const pin = bindPinBoxes(overlay, 'own-pin');
    const confirm = bindPinBoxes(overlay, 'own-pin-confirm');
    const errorEl = overlay.querySelector('#own-pin-error');
    const saveBtn = overlay.querySelector('#own-pin-save');
    pin.focus();

    const showError = (msg) => {
      errorEl.textContent = msg;
      errorEl.classList.toggle('hidden', !msg);
    };
    const finish = (ok) => {
      overlay.remove();
      resolve(ok);
    };

    overlay.querySelector('#own-pin-cancel').onclick = () => finish(false);

    overlay.querySelector('#own-pin-form').onsubmit = async (e) => {
      e.preventDefault();
      showError('');
      if (isWeakPin(pin.value)) return showError(PIN_HELP);
      if (pin.value !== confirm.value) return showError('The two PINs do not match.');

      saveBtn.disabled = true;
      const { error } = await supabase.rpc('set_my_pin', { p_pin: pin.value });
      saveBtn.disabled = false;
      if (error) return showError(error.message || 'Could not save the PIN.');

      Toast.success('Your POS PIN is saved.');
      finish(true);
    };
  });
}

// true  = has a PIN (or the database cannot tell, so we do not block anyone)
// false = confirmed: no PIN yet
export async function hasOwnPin() {
  const { data, error } = await supabase.rpc('my_pin_status');
  if (error) return true;
  return data === true;
}

// Prompts once when the person has no PIN. Resolves true when they may carry on.
export async function ensureOwnPin(options) {
  if (await hasOwnPin()) return true;
  return pinSetupDialog(options);
}
