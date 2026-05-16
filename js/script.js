
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
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.1 });
  revealEls.forEach(el => io.observe(el));
}

/* ── Footer year ── */
const yr = document.getElementById('yr');
if (yr) yr.textContent = new Date().getFullYear();

/* ── Lead Form — HubSpot ── */
const form = document.getElementById('leadForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = form.querySelector('button[type="submit"]');
    const ok  = document.getElementById('formOk');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    // Collect fields
    const nome     = (form.nome?.value || '').trim();
    const empresa  = (form.empresa?.value || '').trim();
    const email    = (form.email?.value || '').trim();
    const telefone = (form.telefone?.value || '').trim();
    const interesse       = form.interesse?.value || '';
    const evento_interesse = form.evento_interesse?.value || '';
    const email_consent   = form.email_consent?.checked;
    const lgpd_consent    = form.info?.checked;

    // Validate
    if (!nome || !email) {
      btn.disabled = false;
      btn.textContent = 'Quero receber informações →';
      alert('Por favor, preencha nome e e-mail.');
      return;
    }

    const parts = nome.split(' ');
    const firstname = parts[0] || '';
    const lastname  = parts.slice(1).join(' ') || '';

    try {
      // ── HubSpot Forms API ──
      // FIX 1: campos 'interesse' e 'evento_interesse' precisam existir no HubSpot
      //         antes de enviar — usando apenas campos padrão + campos customizados válidos
      // FIX 2: subscriptionTypeId 999 não existe — removido legalConsentOptions
      //         (o formulário HubSpot já tem LGPD configurado no próprio portal)
      // FIX 3: context adicionado (pageUri e pageName) para rastreamento

      const hsPayload = {
        fields: [
          { name: 'firstname', value: firstname },
          { name: 'lastname',  value: lastname  },
          { name: 'email',     value: email     },
          { name: 'company',   value: empresa   },
          { name: 'phone',     value: telefone  },
          { name: 'message',   value:
            `Interesse: ${interesse} | Evento: ${evento_interesse} | Email consent: ${email_consent ? 'sim' : 'nao'} | LGPD: ${lgpd_consent ? 'sim' : 'nao'}`
          }
        ],
        context: {
          pageUri:  'https://betonbr.com',
          pageName: 'Bet ON Brasil: Tech Edition'
        }
      };

      const hsRes = await fetch(
        'https://api.hsforms.com/submissions/v3/integration/submit/44677090/7b98c46d-77c8-40b2-88fd-6aeb4d1b4869',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(hsPayload)
        }
      );

      // Log HubSpot response for debugging
      if (!hsRes.ok) {
        const errText = await hsRes.text();
        console.error('HubSpot error:', hsRes.status, errText);
      } else {
        console.log('HubSpot OK:', hsRes.status);
      }

      // ── Formspree (backup) ──
      await fetch('https://formspree.io/f/xvgrzpow', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ nome, email, empresa, telefone, interesse, evento_interesse,
          email_consent: email_consent ? 'sim' : 'nao',
          lgpd_consent:  lgpd_consent  ? 'sim' : 'nao' })
      });

      // Success
      form.reset();
      if (ok) ok.style.display = 'block';
      btn.textContent = '✓ Enviado!';

    } catch (err) {
      console.error('Form error:', err);
      btn.disabled = false;
      btn.textContent = 'Quero receber informações →';
      alert('Erro ao enviar. Tente novamente ou entre em contato diretamente.');
    }
  });
}
