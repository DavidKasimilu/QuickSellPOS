export const Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-stack';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'info', duration = 3500) {
    this.init();

    const toastEl = document.createElement('div');
    toastEl.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
    
    const iconName = type === 'error' ? 'alert-circle' : 'check-circle-2';
    
    toastEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <i data-lucide="${iconName}" style="width: 16px; height: 16px; color: ${type === 'error' ? 'var(--color-danger)' : 'var(--teal-600)'}; flex-shrink: 0;"></i>
        <span>${message}</span>
      </div>
    `;

    this.container.appendChild(toastEl);

    if (window.lucide) {
      window.lucide.createIcons({ root: toastEl });
    }

    setTimeout(() => {
      toastEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(20px)';
      setTimeout(() => toastEl.remove(), 200);
    }, duration);
  },

  success(msg, dur) {
    this.show(msg, 'success', dur);
  },

  error(msg, dur) {
    this.show(msg, 'error', dur);
  },
};