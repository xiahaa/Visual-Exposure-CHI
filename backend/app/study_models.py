from typing import Any, Literal

from pydantic import BaseModel, Field


StudyProfile = Literal["A", "B", "C", "D"]
DisclosureCondition = Literal["M", "S", "V"]


class StudyLaunchRequest(BaseModel):
    """Anonymous browser request for an idempotent study assignment."""

    client_nonce: str = Field(min_length=16, max_length=160)
    # Optional opaque referral value supplied by an external questionnaire.
    # Only a one-way hash is persisted by the backend.
    entry_token: str | None = Field(default=None, min_length=4, max_length=512)
    language: Literal["en", "zh"] = "en"


class StudySessionResponse(BaseModel):
    session_id: str
    session_token: str | None = None
    profile: StudyProfile
    disclosure_condition: DisclosureCondition
    status: Literal["active", "completed", "abandoned", "invalid"]
    phase: str
    question_config_version: str
    completion_code: str | None = None


class StudyEventInput(BaseModel):
    event_id: str = Field(min_length=8, max_length=128)
    seq: int = Field(ge=0)
    event_type: str = Field(min_length=1, max_length=96)
    phase: str = Field(min_length=1, max_length=96)
    payload: dict[str, Any] = Field(default_factory=dict)
    client_timestamp: str | None = Field(default=None, max_length=64)


class StudyEventBatchRequest(BaseModel):
    events: list[StudyEventInput] = Field(min_length=1, max_length=1000)


class StudyEventBatchResponse(BaseModel):
    accepted: int
    duplicates: int
    last_seq: int


class StudyResponseInput(BaseModel):
    phase: str = Field(min_length=1, max_length=96)
    question_id: str = Field(min_length=1, max_length=96)
    response_value: Any
    response_time_ms: int | None = Field(default=None, ge=0)
    q2_asked: bool | None = None
    skip_reason: str | None = Field(default=None, max_length=160)


class StudyResponseBatchRequest(BaseModel):
    responses: list[StudyResponseInput] = Field(min_length=1, max_length=200)


class StudyResponseBatchResponse(BaseModel):
    accepted: int


class StudyStateRequest(BaseModel):
    phase: str = Field(min_length=1, max_length=96)


class StudyCompleteResponse(BaseModel):
    session_id: str
    completion_code: str
    profile: StudyProfile
    disclosure_condition: DisclosureCondition
    completed_at: str


class CompletionCodeVerifyRequest(BaseModel):
    completion_code: str = Field(min_length=6, max_length=40)


class CompletionCodeVerifyResponse(BaseModel):
    valid: bool
    session_id: str | None = None
    profile: StudyProfile | None = None
    disclosure_condition: DisclosureCondition | None = None
    completed_at: str | None = None
