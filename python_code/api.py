from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from engine import VeriDocEngine
import uvicorn
import json

app = FastAPI()

class QueryRequest(BaseModel):
    question: str

print("Initializing AI Engine...")
try:
    rag_engine = VeriDocEngine()
    print("✅ AI Engine Ready!")
except Exception as e:
    print(f" Failed to initialize engine: {e}")
    rag_engine = None

@app.get("/")
def health_check():
    return {"status": "active"}

@app.post("/stream")
async def stream_query_endpoint(request: QueryRequest):
    """
    Endpoints that returns a continuous stream of text.
    """
    if not rag_engine:
        raise HTTPException(status_code=500, detail="AI Engine not initialized")

    def event_stream():
        try:
            # Get the generator from the engine
            for token in rag_engine.stream_query(request.question):
                # We format it as Server-Sent Events (SSE) data
                # SSE requires "data: <content>\n\n"
                yield f"data: {json.dumps({'token': token})}\n\n"
            
            # Send a "DONE" signal so the frontend knows to stop listening
            yield "data: [DONE]\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)