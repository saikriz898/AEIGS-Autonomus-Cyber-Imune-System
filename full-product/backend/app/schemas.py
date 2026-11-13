from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Literal


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="after")
    @classmethod
    def nonblank_text(cls, value, info):
        if isinstance(value, str) and info.field_name != "password":
            if not value.strip():
                raise ValueError("Text fields cannot be blank.")
            return value.strip()
        return value


class Login(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class Setup(Login):
    name: str = Field(min_length=2, max_length=80)
    workspace_name: str = Field(min_length=2, max_length=80)
    scope: str = Field(min_length=10, max_length=2000)

    @field_validator("password")
    @classmethod
    def strong_password(cls, value):
        if len(value) < 12:
            raise ValueError("Use a password with at least 12 characters.")
        return value


class WorkspaceCreate(StrictModel):
    name: str = Field(min_length=2, max_length=80)
    scope: str = Field(min_length=10, max_length=2000)
    seed_demo: bool = True


class WorkspacePatch(StrictModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    scope: str | None = Field(default=None, min_length=10, max_length=2000)
    settings: dict | None = None


class AssetPatch(StrictModel):
    owner: str | None = Field(default=None, min_length=1, max_length=100)
    criticality: Literal["Critical", "High", "Medium", "Low"] | None = None
    exposure: Literal["Internet", "Internal", "Isolated"] | None = None
    status: Literal["Monitored", "Review", "Protected"] | None = None
    notes: str | None = Field(default=None, max_length=1500)


class AssetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    asset_type: Literal["Gateway", "Server", "Database", "Endpoint", "Cloud"]
    owner: str = Field(min_length=1, max_length=100)
    criticality: Literal["Critical", "High", "Medium", "Low"]
    exposure: Literal["Internet", "Internal", "Isolated"]
    address: str | None = Field(default=None, max_length=250)
    notes: str = Field(default="", max_length=1500)
    environment: Literal["Production", "Staging", "Corporate"] = "Production"
    services: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("name", "owner", "address", mode="before")
    @classmethod
    def inventory_text(cls, value):
        if value is None:
            return value
        if not isinstance(value, str):
            raise ValueError("Inventory fields must be text.")
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Inventory fields cannot contain control characters.")
        return value.strip()

    @field_validator("services")
    @classmethod
    def service_labels(cls, values):
        clean = []
        for value in values:
            value = value.strip()
            if not value or len(value) > 80 or any(ord(c) < 32 for c in value):
                raise ValueError("Service labels must contain 1–80 printable characters.")
            if value not in clean:
                clean.append(value)
        return clean


class FindingPatch(StrictModel):
    status: Literal["Open", "Investigating", "Resolved"]


class PathRequest(StrictModel):
    start_asset_id: str
    target_asset_id: str


class ScenarioCreate(PathRequest):
    name: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=10, max_length=2000)
    assumptions: list[str] = Field(default_factory=list, max_length=20)


class SimulationCreate(StrictModel):
    scenario_id: str


class DecisionCreate(StrictModel):
    decision: Literal["Approved", "Rejected"]
    notes: str = Field(min_length=5, max_length=1500)

    @field_validator("notes")
    @classmethod
    def notes_content(cls, value):
        if len(value.strip()) < 5:
            raise ValueError("Add meaningful review notes.")
        return value.strip()


class NamedRequest(StrictModel):
    name: str = Field(min_length=2, max_length=120)


class MemberCreate(Login):
    name: str = Field(min_length=2, max_length=80)
    role: Literal["Owner", "Admin", "Analyst", "Viewer"] = "Viewer"

    @field_validator("password")
    @classmethod
    def member_password(cls, value):
        if len(value) < 12:
            raise ValueError("Use a password with at least 12 characters.")
        return value


class RolePatch(StrictModel):
    role: Literal["Owner", "Admin", "Analyst", "Viewer"]


class ExistingMember(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    role: Literal["Owner", "Admin", "Analyst", "Viewer"] = "Viewer"


class EventPatch(StrictModel):
    status: Literal["New", "Investigating", "Closed"]
