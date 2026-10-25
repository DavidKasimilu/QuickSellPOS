export const Modal = {
  container: null,

  init() {
    this.container = document.getElementById('global-modal');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'global-modal';
      this.container.className = 'modal-backdrop hidden';
      document.body.appendChild(this.container);
    }

    // Dismiss on clicking backdrop outside of modal card
    this.container.onclick = (e) => {
      if (e.target === this.container) {
        this.close();
      }
    };

    // Close on Escape key press
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.container.classList.contains('hidden')) {
        this.close();
      }
    });
  },

  open({ title, content, onSubmit, maxWidth = '560px' }) {
    this.init();
    this.container.innerHTML = `
      <div class="auth-card" style="max-width: ${maxWidth}; width: 100%; position: relative; max-height: 90vh; display: flex; flex-direction: column; animation: slideIn 0.2s ease;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px; flex-shrink: 0;">
          <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin: 0;">${title}</h3>
          <button class="btn-icon" id="modal-close-trigger" title="Close" style="cursor: pointer;">
            <i data-lucide="x" style="width: 20px; height: 20px;"></i>
          </button>
        </div>
        <div class="modal-body-content" style="overflow-y: auto; padding-right: 4px;">
          ${content}
        </div>
      </div>
    `;

    // Bind close trigger
    const closeBtn = this.container.querySelector('#modal-close-trigger');
    if (closeBtn) {
      closeBtn.onclick = () => this.close();
    }

    // Initialize icons inside injected markup
    if (window.lucide) {
      window.lucide.createIcons({ root: this.container });
    }

    this.container.classList.remove('hidden');

    // Automatically handle form submissions
    if (onSubmit) {
      const form = this.container.querySelector('form');
      if (form) {
        form.onsubmit = async (e) => {
          e.preventDefault();
          const submitBtn = form.querySelector('button[type="submit"]');
          const originalText = submitBtn ? submitBtn.innerHTML : '';
          
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `Processing...`;
          }

          try {
            const formData = Object.fromEntries(new FormData(form).entries());
            const shouldKeepOpen = await onSubmit(formData);
            
            // Only close if the handler did not explicitly return false
            if (shouldKeepOpen !== false) {
              this.close();
            }
          } catch (err) {
            console.error('[Modal] Form submit execution error:', err);
          } finally {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = originalText;
            }
          }
        };
      }
    }
  },

  close() {
    if (this.container) {
      this.container.classList.add('hidden');
      this.container.innerHTML = '';
    }
  },
};