import asyncio
import hmac
import io
import os
from functools import lru_cache

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from .config import load_backend_config
from .study_models import (
    CompletionCodeVerifyRequest,
    CompletionCodeVerifyResponse,
    StudyCompleteResponse,
    StudyEventBatchRequest,
    StudyEventBatchResponse,
    StudyLaunchRequest,
    StudyResponseBatchRequest,
    StudyResponseBatchResponse,
    StudySessionResponse,
    StudyStateRequest,
)
from .study_service import (
    InvalidStudyTokenError,
    StudyCapacityError,
    StudyService,
    StudyValidationError,
)


router = APIRouter(prefix="/api")


@lru_cache(maxsize=1)
def get_study_service() -> StudyService:
    return StudyService(load_backend_config().study)


@router.post("/study/launch", response_model=StudySessionResponse)
async def launch_study(request: StudyLaunchRequest) -> StudySessionResponse:
    """Create or recover an anonymous, server-assigned study session."""

    try:
        return await asyncio.to_thread(get_study_service().launch, request)
    except StudyCapacityError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/study/session", response_model=StudySessionResponse)
async def get_study_session(
    x_study_token: str = Header(alias="X-Study-Token"),
) -> StudySessionResponse:
    return await _with_study_token(get_study_service().get_session, x_study_token)


@router.post("/study/confirm-start", response_model=StudySessionResponse)
async def confirm_study_start(
    x_study_token: str = Header(alias="X-Study-Token"),
) -> StudySessionResponse:
    return await _with_study_token(get_study_service().confirm_start, x_study_token)


@router.post("/study/state", response_model=StudySessionResponse)
async def update_study_state(
    request: StudyStateRequest,
    x_study_token: str = Header(alias="X-Study-Token"),
) -> StudySessionResponse:
    return await _with_study_token(
        get_study_service().update_phase,
        x_study_token,
        request.phase,
    )


@router.post("/study/events", response_model=StudyEventBatchResponse)
async def append_study_events(
    request: StudyEventBatchRequest,
    x_study_token: str = Header(alias="X-Study-Token"),
) -> StudyEventBatchResponse:
    return await _with_study_token(
        get_study_service().append_events,
        x_study_token,
        request.events,
    )


@router.post("/study/responses", response_model=StudyResponseBatchResponse)
async def save_study_responses(
    request: StudyResponseBatchRequest,
    x_study_token: str = Header(alias="X-Study-Token"),
) -> StudyResponseBatchResponse:
    accepted = await _with_study_token(
        get_study_service().save_responses,
        x_study_token,
        request.responses,
    )
    return StudyResponseBatchResponse(accepted=accepted)


@router.post("/study/complete", response_model=StudyCompleteResponse)
async def complete_study(
    x_study_token: str = Header(alias="X-Study-Token"),
) -> StudyCompleteResponse:
    return await _with_study_token(get_study_service().complete, x_study_token)


@router.post("/study/verify-code", response_model=CompletionCodeVerifyResponse)
async def verify_completion_code(
    request: CompletionCodeVerifyRequest,
    x_admin_key: str = Header(alias="X-Admin-Key"),
) -> CompletionCodeVerifyResponse:
    _require_admin_key(x_admin_key)
    return await asyncio.to_thread(
        get_study_service().verify_completion_code,
        request.completion_code,
    )


@router.get("/admin/study-pool")
async def get_study_pool(
    x_admin_key: str = Header(alias="X-Admin-Key"),
) -> dict:
    _require_admin_key(x_admin_key)
    return await asyncio.to_thread(get_study_service().pool_summary)


@router.get("/admin/study-results/{completion_code}")
async def get_study_result(
    completion_code: str,
    x_admin_key: str = Header(alias="X-Admin-Key"),
) -> dict:
    """Resolve a questionnaire completion code to its persisted study data."""

    _require_admin_key(x_admin_key)
    result = await asyncio.to_thread(
        get_study_service().completion_record,
        completion_code,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Completion code not found")
    return result


@router.get("/admin/export/all")
async def export_all_study_data(
    x_admin_key: str = Header(alias="X-Admin-Key"),
) -> StreamingResponse:
    _require_admin_key(x_admin_key)
    archive = await asyncio.to_thread(get_study_service().export_archive)
    return StreamingResponse(
        io.BytesIO(archive),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="vep-study-export.zip"'},
    )


async def _with_study_token(function, session_token: str, *args):
    try:
        return await asyncio.to_thread(function, session_token, *args)
    except InvalidStudyTokenError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except StudyValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _require_admin_key(provided_key: str) -> None:
    config = load_backend_config().study
    expected_key = os.getenv(config.admin_key_env)
    if not expected_key:
        raise HTTPException(
            status_code=503,
            detail=f"Admin API is disabled until {config.admin_key_env} is configured",
        )
    if not hmac.compare_digest(provided_key, expected_key):
        raise HTTPException(status_code=403, detail="Invalid admin key")
