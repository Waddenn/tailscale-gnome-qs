ARG FEDORA_VERSION=39
FROM fedora:${FEDORA_VERSION}

RUN dnf -y install git make gettext gnome-shell dbus-daemon ripgrep \
    $(if [ "${FEDORA_VERSION}" -ge 43 ]; then echo mutter-devel; fi) && \
    dnf clean all
