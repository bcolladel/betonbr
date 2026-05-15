
/* Bet ON Brasil — Tech Edition | script.js */

/* ── NAV scroll ── */
const nav = document.getElementById('nav');
if (nav) {
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
}

/* ── Reveal on scroll ── */
const revealEls = document.querySelectorAll('.reveal');
if (revealEls.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: 0.1 });
  revealEls.forEach(el => io.observe(el));
}

/* ── Footer year ── */
const yr = document.getElementById('yr');
if (yr) yr.textContent = new Date().getFullYear();

/* ── Lead Form — HubSpot + Wix CRM ── */
const form = document.getElementById('leadForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = form.querySelector('button[type="submit"]');
    const ok  = document.getElementById('formOk');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    // Collect all fields
    const data = {
      nome:            form.nome?.value?.trim() || '',
      empresa:         form.empresa?.value?.trim() || '',
      email:           form.email?.value?.trim() || '',
      telefone:        form.telefone?.value?.trim() || '',
      interesse:       form.interesse?.value || '',
      evento_interesse:form.evento_interesse?.value || '',
      email_consent:   form.email_consent?.checked ? 'sim' : 'nao',
      lgpd_consent:    form.info?.checked ? 'sim' : 'nao',
      origem:          'landing-betonbr-tech-edition',
      timestamp:       new Date().toISOString()
    };

    // Validate required
    if (!data.nome || !data.email) {
      btn.disabled = false;
      btn.textContent = 'Quero receber informações →';
      alert('Por favor, preencha nome e e-mail.');
      return;
    }

    try {
      // ── 1. HubSpot Forms API (portal 48584793 — substitua pelo seu) ──
      const HUBSPOT_PORTAL_ID  = '44677090';
      const HUBSPOT_FORM_GUID  = '7b98c46d-77c8-40b2-88fd-6aeb4d1b4869';
      const hsPayload = {
        fields: [
          { name: 'firstname',        value: data.nome.split(' ')[0] },
          { name: 'lastname',         value: data.nome.split(' ').slice(1).join(' ') },
          { name: 'company',          value: data.empresa },
          { name: 'email',            value: data.email },
          { name: 'phone',            value: data.telefone },
          { name: 'interesse',        value: data.interesse },
          { name: 'evento_interesse', value: data.evento_interesse },
          { name: 'email_consent',    value: data.email_consent },
          { name: 'lgpd_consent',     value: data.lgpd_consent },
        ],
        legalConsentOptions: {
          consent: {
            consentToProcess: data.lgpd_consent === 'sim',
            text: 'Concordo em compartilhar meus dados conforme a LGPD (Lei 13.709/2018).',
            communications: data.email_consent === 'sim' ? [
              { value: true, subscriptionTypeId: 999, text: 'Quero receber informações e condições especiais por e-mail.' }
            ] : []
          }
        }
      };

      await fetch(
          `https://api.hsforms.com/submissions/v3/integration/submit/${HUBSPOT_PORTAL_ID}/${HUBSPOT_FORM_GUID}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hsPayload) }
      );

      // ── 2. Wix Inbox / CRM via Wix Forms ──
      // Envia para o endpoint do Wix (configurar webhook no painel Wix)
      const WIX_WEBHOOK = 'SEU_WIX_WEBHOOK_URL';
      if (WIX_WEBHOOK !== 'SEU_WIX_WEBHOOK_URL') {
        await fetch(WIX_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }

      // ── 3. Fallback: Formspree (funciona sem configuração extra) ──
      await fetch('https://formspree.io/f/xvgrzpow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          nome: data.nome, email: data.email, empresa: data.empresa,
          telefone: data.telefone, interesse: data.interesse,
          evento_interesse: data.evento_interesse,
          email_consent: data.email_consent, lgpd_consent: data.lgpd_consent
        })
      });

      // Success
      form.reset();
      if (ok) { ok.style.display = 'block'; }
      btn.textContent = '✓ Enviado!';

    } catch (err) {
      console.error('Form error:', err);
      btn.disabled = false;
      btn.textContent = 'Quero receber informações →';
    }
  });
}
