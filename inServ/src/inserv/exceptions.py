class IntentNotFound(Exception):
    """Raised when the requested Intent does not exist."""


class IntentConflict(Exception):
    """Raised when attempting to create an Intent that already exists."""


