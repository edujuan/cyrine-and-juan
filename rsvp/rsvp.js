(function rsvp() {
  const form = document.getElementById('rsvp');
  const thanks = document.getElementById('thanks');
  const error = document.getElementById('form-error');
  const attendingOnly = form.querySelectorAll('.if-attending');
  const submit = form.querySelector('button[type="submit"]');
  const endpoint = form.dataset.endpoint.trim();
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
    if (!email.value.trim() || !email.checkValidity()) return { field: 'email', text: 'Please add a valid email address.' };
    return null;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
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
    try {
      if (endpoint) {
        const response = await fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`RSVP endpoint returned ${response.status}`);
      }
    } catch (failure) {
      console.error(failure);
      error.textContent = 'Your answer could not be sent. Please try again in a moment.';
      error.hidden = false;
      submit.disabled = false;
      return;
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
