import uuid
from datetime import datetime, date

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey,
    Integer, Numeric, SmallInteger, String, Text,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class VehicleProfile(Base):
    __tablename__ = "vehicle_profiles"

    id            = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    vehicle_id    = Column(String(12),  nullable=False, unique=True, index=True)
    language_pref = Column(String(10),  nullable=False, default="hi")
    registered_at = Column(DateTime,    nullable=False, default=datetime.utcnow)
    is_active     = Column(Boolean,     nullable=False, default=True)

    sessions = relationship("DriveSession", back_populates="vehicle", lazy="noload")
    streaks  = relationship("SafetyStreak", back_populates="vehicle", lazy="noload")


class DriveSession(Base):
    __tablename__ = "drive_sessions"

    id                 = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    vehicle_id         = Column(String(12), ForeignKey("vehicle_profiles.vehicle_id"), nullable=False, index=True)
    started_at         = Column(DateTime, nullable=False, default=datetime.utcnow)
    ended_at           = Column(DateTime, nullable=True)
    final_state        = Column(String(20), nullable=True)    # completed | rest_mandatory | emergency_triggered | app_killed
    hard_lock_at       = Column(DateTime, nullable=True)
    rest_cleared_at    = Column(DateTime, nullable=True)
    peak_fatigue_score = Column(SmallInteger, nullable=True)
    avg_fatigue_score  = Column(Numeric(4, 2), nullable=True)
    total_checks       = Column(SmallInteger, nullable=False, default=0)
    failed_checks      = Column(SmallInteger, nullable=False, default=0)
    streak_day         = Column(Integer, nullable=False, default=0)
    safety_points      = Column(Integer, nullable=False, default=0)

    vehicle = relationship("VehicleProfile", back_populates="sessions")
    logs    = relationship("FatigueLog", back_populates="session", lazy="noload")


class FatigueLog(Base):
    __tablename__ = "fatigue_logs"

    id                   = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id           = Column(String(36), ForeignKey("drive_sessions.id"), nullable=False, index=True)
    vehicle_id           = Column(String(12), nullable=False, index=True)   # denormalized
    checked_at           = Column(DateTime, nullable=False, default=datetime.utcnow)
    drive_hour           = Column(SmallInteger, nullable=False, default=0)
    question_text        = Column(Text, nullable=False)
    question_lang        = Column(String(10), nullable=False, default="hi")
    response_latency_ms  = Column(Integer, nullable=True)
    raw_transcript       = Column(Text, nullable=True)                       # purge after 24h
    fatigue_score        = Column(SmallInteger, nullable=False)
    latency_flag         = Column(String(10), nullable=True)
    coherence_flag       = Column(String(10), nullable=True)
    slur_flag            = Column(String(10), nullable=True)
    gpt_coherence_score  = Column(Numeric(3, 2), nullable=True)
    danger_bubble_active = Column(Boolean, nullable=False, default=False)
    suggested_poi_name   = Column(Text, nullable=True)
    suggested_poi_dist_m = Column(Integer, nullable=True)
    sms_sent             = Column(Boolean, nullable=False, default=False)
    sms_sent_at          = Column(DateTime, nullable=True)

    session = relationship("DriveSession", back_populates="logs")


class SafetyStreak(Base):
    __tablename__ = "safety_streaks"

    id             = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    vehicle_id     = Column(String(12), ForeignKey("vehicle_profiles.vehicle_id"), nullable=False)
    streak_date    = Column(Date, nullable=False)
    sessions_count = Column(SmallInteger, nullable=False, default=0)
    max_fatigue    = Column(SmallInteger, nullable=True)
    streak_broken  = Column(Boolean, nullable=False, default=False)
    points_earned  = Column(Integer, nullable=False, default=0)

    vehicle = relationship("VehicleProfile", back_populates="streaks")
