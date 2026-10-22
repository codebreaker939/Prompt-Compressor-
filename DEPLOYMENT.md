# Deploying Prompt Reducer

Prompt Reducer has two parts that must be deployed separately:

1. **FastAPI compressor** — runs Python, LLMLingua, and the compression model.
2. **Chrome extension** — provides the popup and calls the compressor over HTTP(S).

For personal use, run the API on your computer and load the extension locally. For other users, host the API at a public HTTPS URL and publish the extension through the Chrome Web Store.

## 1. Run locally (recommended first)

From this project folder, create and activate a virtual environment, install dependencies, and start the API:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8080 --reload
```

Open `http://127.0.0.1:8080/docs`. Under `POST /compress`, click **Try it out** and send this body:

```json
{
  "text": "Please create a concise API documentation page for our application.",
  "rate": 0.5
}
```

The first AI-compression request can take longer because LLMLingua downloads and loads its model.

Next, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project folder. Chrome documents this local development workflow in its [extension development basics](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).

## 2. Host the FastAPI service publicly

Use a hosting provider that supports Python, long-running HTTP services, enough memory for the model, and outbound access during the initial model download. A container platform or VM is usually a better fit than a serverless function for this model-backed API.

### Build settings

Use these settings with your provider:

| Setting | Value |
| --- | --- |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app:app --host 0.0.0.0 --port $PORT` |
| Health check | `GET /health` |
| Required protocol | HTTPS |

If your provider does not supply a `PORT` environment variable, replace `$PORT` with the port configured by that provider.

Before sharing the API, test it from your terminal. Replace `https://api.example.com` with your deployed URL:

```bash
curl -X POST https://api.example.com/compress \
  -H 'Content-Type: application/json' \
  -d '{"text":"Please create a concise API documentation page for our application.","rate":0.5}'
```

You should receive JSON containing `reducedText`, `engine: "llmlingua"`, compression details, token statistics, and Jaccard similarity data.

### Production security checklist

- Use HTTPS; do not send user prompts to a public HTTP endpoint.
- Add authentication and rate limiting before exposing the API publicly.
- Replace `allow_origins=["*"]` in `app.py` with the known extension origin after publishing, for example `chrome-extension://YOUR_EXTENSION_ID`.
- Monitor errors, model-memory use, and costs. Do not log user prompts unless users have agreed to it.

## 3. Point the extension to the hosted API

The extension currently calls the local address in `reducer.js`:

```js
const DEFAULT_API_URL = 'http://127.0.0.1:8080/compress';
```

Change it to your public HTTPS endpoint:

```js
const DEFAULT_API_URL = 'https://api.example.com/compress';
```

Then change `host_permissions` in `manifest.json` to match the same host:

```json
"host_permissions": [
  "https://api.example.com/*"
]
```

Chrome host permissions are required for an extension to interact with matching URLs, and changing them can prompt users for new access. See the [official permissions guide](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions).

Reload the unpacked extension after making these changes, then test compression from the popup.

## 4. Publish the extension

Do not upload the Python API, virtual environment, model cache, or `__pycache__` to the Chrome Web Store. Create a clean ZIP containing only the extension files:

```bash
zip -r prompt-reducer-extension.zip \
  manifest.json popup.html popup.css popup.js reducer.js
```

In the Chrome Web Store Developer Dashboard:

1. Create a developer account if needed.
2. Upload `prompt-reducer-extension.zip`.
3. Complete the store listing: name, description, icon, screenshots, category, and privacy disclosures.
4. Clearly disclose that prompts are sent to your API and link to your privacy policy.
5. Submit the extension for review, then publish after approval.

The packaged ZIP must contain `manifest.json` at its root. Google’s [publishing guide](https://developer.chrome.com/docs/webstore/publish/) describes the current Chrome Web Store submission process.

## Release checklist

- [ ] `GET /health` returns `{"status":"ok", ...}` from the deployed URL.
- [ ] A `POST /compress` request returns a non-empty `reducedText`.
- [ ] The extension uses the production HTTPS URL and matching `host_permissions`.
- [ ] CORS is restricted and the API has authentication/rate limiting.
- [ ] The unpacked extension is reloaded and tested.
- [ ] The store ZIP contains only extension assets, with `manifest.json` at the ZIP root.
