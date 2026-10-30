(function rsvp() {
  const form = document.getElementById('rsvp');
  const thanks = document.getElementById('thanks');
  const error = document.getElementById('form-error');
  const attendingOnly = form.querySelectorAll('.if-attending');
  const submit = form.querySelector('button[type="submit"]');
  const endpoint = form.dataset.endpoint.trim();
  let lastAttempt;
  document.getElementById('form-preview').hidden = Boolean(endpoint);
  if (!endpoint) submit.textContent = 'Preview RSVP';

  form.addEventListener('change', (event) => {
    if (event.target.name !== 'attending') return;
    attendingOnly.forEach((field) => { field.hidden = event.target.value !== 'yes'; });
  });

  function problem() {
    const data = new FormData(form);
    if (!String(data.get('names') || '').trim()) return { field: 'names', text: 'Please add your name(s).' };
    if (!data.get('attending')) return { field: 'attending', text: 'Please choose whether you can join us.' };
    const email = form.elements.email;
    if (!email.checkValidity() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return { field: 'email', text: 'Please add a valid email address.' };
    return null;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const issue = problem();
    if (issue) {
      error.textContent = issue.text;
      error.hidden = false;
      const target = form.elements[issue.field];
      (target.length ? target[0] : target).focus();
      return;
    }
    error.hidden = true;
    const data = new FormData(form);
    submit.disabled = true;
    submit.textContent = endpoint ? 'Sending…' : 'Preview RSVP';
    form.setAttribute('aria-busy', 'true');
    try {
      if (endpoint) {
        const body = new URLSearchParams();
        for (const [name, value] of data) body.set(name, String(value).trim());
        body.set('updates', data.get('updates') === 'yes' ? 'yes' : 'no');
        if (data.get('attending') !== 'yes') body.set('diet', '');
        body.set('version', '1');
        const fingerprint = body.toString();
        if (!lastAttempt || lastAttempt.fingerprint !== fingerprint) {
          lastAttempt = { fingerprint, id: crypto.randomUUID() };
        }
        body.set('submissionId', lastAttempt.id);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          // A normal form POST avoids a cross-origin preflight. Read Google's
          // receipt after the redirect; an opaque response is never success.
          const response = await fetch(endpoint, {
            method: 'POST', body, credentials: 'omit', redirect: 'follow',
            headers: { Accept: 'application/json' }, signal: controller.signal
          });
          if (!response.ok) throw new Error('RSVP service unavailable');
          const receipt = await response.json();
          if (receipt.ok !== true || receipt.submissionId !== lastAttempt.id) {
            throw new Error('No confirmed RSVP receipt');
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch (failure) {
      console.error(failure);
      error.textContent = "We couldn't confirm your RSVP. Your answers are still here; please try again.";
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Send my RSVP';
      return;
    } finally {
      form.removeAttribute('aria-busy');
    }
    const attending = data.get('attending') === 'yes';
    document.getElementById('thanks-yes').hidden = !endpoint || !attending;
    document.getElementById('thanks-no').hidden = !endpoint || attending;
    document.getElementById('thanks-updates').hidden = !endpoint || data.get('updates') !== 'yes';
    document.getElementById('preview-note').hidden = Boolean(endpoint);
    if (!endpoint) thanks.querySelector('h2').textContent = 'RSVP preview';
    document.getElementById('form-preview').hidden = true;
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus();
  });
})();
