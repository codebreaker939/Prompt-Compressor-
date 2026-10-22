# Prompt Reducer extension

A Chrome/Edge Manifest V3 extension that reduces prompts through a local FastAPI API, with a local rule-based fallback.

## Start the API

Install the API dependencies, then start the service:

```bash
pip install -r requirements.txt
uvicorn app:app --port 8080 --reload
```

The extension calls `POST http://127.0.0.1:8080/compress`, which uses LLMLingua. `POST /reduce` remains available for immediate rule-based reduction, and API documentation is at `http://127.0.0.1:8080/docs`.

## Load it locally

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the `extension` folder.
4. Pin **Prompt Reducer**, click its icon, enter a prompt, then choose **Reduce prompt**.
