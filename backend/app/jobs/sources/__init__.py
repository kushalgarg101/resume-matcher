from app.jobs.sources.base import JobSource
from app.jobs.sources.rss_source import RSSSource
from app.jobs.sources.arbeitnow import ArbeitnowSource
from app.jobs.sources.jooble import JoobleSource
from app.jobs.sources.adzuna import AdzunaSource

__all__ = ["JobSource", "get_all_sources", "get_source_names"]


def get_all_sources() -> list[JobSource]:
    return [
        RSSSource(),
        ArbeitnowSource(),
        JoobleSource(),
        AdzunaSource(),
    ]


def get_source_names() -> list[str]:
    return [s.name for s in get_all_sources()]
