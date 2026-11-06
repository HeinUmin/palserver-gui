# palserver/vanilla — native Linux Palworld dedicated server.
# Game files are fetched at container start via DepotDownloader (64-bit .NET)
# instead of SteamCMD: SteamCMD's bootstrap binary is 32-bit i386, which
# Apple Silicon's Rosetta cannot execute — DepotDownloader works both under
# Rosetta emulation (dev on macOS) and natively on x86_64 Linux hosts.
# Downloading at start keeps the image small and game updates image-free.
FROM ubuntu:24.04

ARG DEPOTDOWNLOADER_VERSION=3.4.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip xdg-user-dirs \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /tmp/dd.zip \
      "https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_${DEPOTDOWNLOADER_VERSION}/DepotDownloader-linux-x64.zip" \
    && unzip /tmp/dd.zip -d /opt/depotdownloader \
    && chmod +x /opt/depotdownloader/DepotDownloader \
    && ln -s /opt/depotdownloader/DepotDownloader /usr/local/bin/DepotDownloader \
    && rm /tmp/dd.zip

# Base image ships an "ubuntu" user at UID 1000; rename it instead of
# fighting over the UID (kept at 1000 so Linux-host bind mounts map cleanly).
RUN usermod -l palworld -d /home/palworld -m ubuntu && groupmod -n palworld ubuntu
USER palworld
ENV HOME=/home/palworld USER=palworld
WORKDIR /home/palworld

COPY entrypoint.sh /entrypoint.sh
USER root
RUN chmod 755 /entrypoint.sh
USER palworld

# /data/saved  -> Pal/Saved (world saves, agent bind-mounts this)
# /data/config -> agent-rendered PalWorldSettings.ini (read-only)
VOLUME ["/data/saved"]

EXPOSE 8211/udp 8212/tcp

ENTRYPOINT ["/entrypoint.sh"]
