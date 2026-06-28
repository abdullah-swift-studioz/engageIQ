import os
import sys

# Make the service package importable when pytest runs from apps/ml-service.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
