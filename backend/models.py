from __future__ import annotations

from pydantic import BaseModel, Field


class StreamInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=4, max_length=2048)
    group_name: str = "General"
    quality: str = "best"
    container: str = "mkv"
    auto_record: bool = False
    monitor: bool = True


class SettingsInput(BaseModel):
    recording_dir: str | None = None
    max_recordings: int | None = Field(default=None, ge=1)
    retry_seconds: int | None = Field(default=None, ge=2, le=3600)
    monitor_seconds: int | None = Field(default=None, ge=10, le=3600)
    low_disk_gb: int | None = Field(default=None, ge=0, le=1000)
    segment_minutes: int | None = Field(default=None, ge=0, le=1440)
    timeshift_buffer_minutes: int | None = Field(default=None, ge=5, le=1440)
    timeshift_max_storage_gb: int | None = Field(default=None, ge=1, le=512)
    timeshift_min_free_gb: int | None = Field(default=None, ge=0, le=1000)
    preview_transcode: bool | None = None
