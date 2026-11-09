import uuid

import time

from fastapi import FastAPI, Request, Response, status

from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import JSONResponse

from sqlalchemy import text



from apps.api.app.core.config import settings

from apps.api.app.infrastructure.observability.logging import logger, sanitize_data

from apps.api.app.infrastructure.security.rate_limiter import get_client_ip

from apps.api.app.infrastructure.db.session import async_engine

from apps.api.app.modules.bookings.service import BookingEngineError

from apps.api.app.api.v1.auth.routes import router as auth_router

from apps.api.app.api.v1.public.routes import router as public_router

from apps.api.app.api.v1.business.routes import router as business_router

from apps.api.app.api.v1.platform.routes import router as platform_router



app = FastAPI(

    title=settings.PROJECT_NAME,

    description="Multi-tenant SaaS Backend for Online Booking, CRM, and Platform Console",

    version="1.0.0",

    docs_url="/docs",

    redoc_url="/redoc",

    openapi_url="/openapi.json"

)



# CORS Middleware

app.add_middleware(

    CORSMiddleware,

    allow_origins=settings.CORS_ORIGINS,

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],

)



# Request ID & Logging Middleware

@app.middleware("http")

async def request_middleware(request: Request, call_next):

    request_id = str(uuid.uuid4())

    request.state.request_id = request_id

    start_time = time.time()



    response: Response = await call_next(request)



    process_time = time.time() - start_time

    response.headers["X-Request-ID"] = request_id

    response.headers["X-Process-Time"] = f"{process_time:.4f}s"

    response.headers["X-Content-Type-Options"] = "nosniff"

    response.headers["X-Frame-Options"] = "DENY"



    # Redacted structured access logging (no passwords or bearer tokens)

    clean_path = sanitize_data(str(request.url.path))

    if request.url.query:

        clean_path = f"{clean_path}?{sanitize_data(request.url.query)}"

    client_ip = get_client_ip(request)

    logger.info(

        f"HTTP {request.method} {clean_path} -> {response.status_code} ({process_time:.4f}s) [ip={client_ip}]",

        extra={"request_id": request_id}

    )



    return response



# Error Handlers

@app.exception_handler(BookingEngineError)

async def booking_engine_exception_handler(request: Request, exc: BookingEngineError):

    req_id = getattr(request.state, "request_id", None)

    return JSONResponse(

        status_code=exc.status_code,

        content={

            "code": exc.code,

            "message": exc.message,

            "error": {

                "code": exc.code,

                "message": exc.message,

                "details": exc.details

            },

            "request_id": req_id

        }

    )



from fastapi.exceptions import HTTPException



@app.exception_handler(HTTPException)

async def http_exception_handler(request: Request, exc: HTTPException):

    req_id = getattr(request.state, "request_id", None)

    if isinstance(exc.detail, dict):

        content = {

            **exc.detail,

            "detail": exc.detail,

            "error": exc.detail,

            "request_id": req_id

        }

        return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)

    return JSONResponse(

        status_code=exc.status_code,

        content={"detail": exc.detail, "message": str(exc.detail), "request_id": req_id},
        headers=exc.headers

    )



# Health Endpoints

@app.get("/health/live", tags=["Health"])

async def health_live():

    """Liveness probe: returns 200 if application process is running."""

    return {"status": "alive", "timestamp": time.time()}



@app.get("/health/ready", tags=["Health"])

async def health_ready():

    """Readiness probe: validates database connectivity."""

    try:

        async with async_engine.connect() as conn:

            await conn.execute(text("SELECT 1;"))

        return {"status": "ready", "database": "connected"}

    except Exception as e:

        return JSONResponse(

            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,

            content={"status": "unhealthy", "database": str(e)}

        )



# Mount API Routers

app.include_router(auth_router, prefix=settings.API_V1_STR)

app.include_router(public_router, prefix=settings.API_V1_STR)

app.include_router(business_router, prefix=settings.API_V1_STR)

app.include_router(platform_router, prefix=settings.API_V1_STR)

