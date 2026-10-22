const form = document.querySelector('#prompt-form');
const promptField = document.querySelector('#prompt');
const output = document.querySelector('#output');
const copyButton = document.querySelector('#copy-button');
const submitButton = document.querySelector('#submit-button');
const apiStatus = document.querySelector('#api-status');

let reducedPrompt = '';

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptField.value;
  if (!prompt.trim()) return;

  submitButton.disabled = true;
  submitButton.textContent = 'Compressing…';
  try {
    const result = await TextReducer.compressWithApi(prompt);
    reducedPrompt = result.reducedText;
    apiStatus.textContent = `Reduced by local FastAPI (${result.engine}).`;
    apiStatus.dataset.state = 'api';
  } catch (error) {
    reducedPrompt = TextReducer.reduce(prompt);
    apiStatus.textContent = 'FastAPI is unavailable; used the same local rule-based reducer.';
    apiStatus.dataset.state = 'fallback';
  } finally {
    output.textContent = reducedPrompt || 'Your compressed prompt will appear here.';
    output.dataset.empty = String(!reducedPrompt);
    copyButton.disabled = !reducedPrompt;
    submitButton.disabled = false;
    submitButton.innerHTML = 'Compress <span aria-hidden="true">→</span>';
  }
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(reducedPrompt);
  copyButton.textContent = 'Copied!';
  setTimeout(() => { copyButton.textContent = 'Copy'; }, 1200);
});
