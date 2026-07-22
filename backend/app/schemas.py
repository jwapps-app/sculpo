from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CredentialsIn(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=200)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    username: str


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
