from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RequestLinkIn(BaseModel):
    email: EmailStr


class RequestLinkOut(BaseModel):
    message: str
    dev_magic_link: str | None = None


class VerifyIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str


class SessionOut(BaseModel):
    session_token: str
    user: UserOut


class ProjectMetaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    created_at: datetime
    updated_at: datetime


class ProjectOut(ProjectMetaOut):
    data: dict[str, Any]


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    data: dict[str, Any]
