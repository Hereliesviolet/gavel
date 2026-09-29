FROM python:3.12-slim

WORKDIR /app

COPY scrapers/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Install the local package in editable mode. The constraints file keeps the
# resolution of the pyproject bounds on the frozen versions: if a bound
# contradicts a pin, the build fails here instead of silently pulling another
# version.
COPY scrapers/pyproject.toml ./
RUN pip install --no-cache-dir -c requirements.txt -e .

COPY scrapers/ .

CMD ["python", "-m", "src.flows.zvg_daily"]
