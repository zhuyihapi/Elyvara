"""Small STUN-only probe. Prints no mapped addresses or credentials."""
import argparse
import os
import socket
import struct

parser = argparse.ArgumentParser()
parser.add_argument("host")
parser.add_argument("--ipv6", action="store_true")
args = parser.parse_args()
family = socket.AF_INET6 if args.ipv6 else socket.AF_INET
target = socket.getaddrinfo(args.host, 3478, family, socket.SOCK_DGRAM)[0][4]
with socket.socket(family, socket.SOCK_DGRAM) as client:
    client.settimeout(4)
    transaction = os.urandom(12)
    client.sendto(struct.pack("!HHI", 1, 0, 0x2112A442) + transaction, target)
    data, _ = client.recvfrom(2048)
    assert len(data) >= 20
    kind, length, cookie = struct.unpack("!HHI", data[:8])
    assert kind == 0x101 and cookie == 0x2112A442 and data[8:20] == transaction
    assert len(data) == 20 + length
    offset = 20
    mapped = False
    while offset + 4 <= len(data):
        attr, size = struct.unpack("!HH", data[offset:offset + 4])
        value = data[offset + 4:offset + 4 + size]
        if attr == 0x20:
            expected = 2 if args.ipv6 else 1
            mapped = len(value) == (20 if expected == 2 else 8) and value[1] == expected
        offset += 4 + ((size + 3) // 4) * 4
    assert mapped, "Missing valid XOR-MAPPED-ADDRESS"
    print("Binding passed; XOR-MAPPED-ADDRESS present; family=" + ("IPv6" if args.ipv6 else "IPv4"))
    transaction = os.urandom(12)
    requested_transport = struct.pack("!HHBBBB", 0x19, 4, 17, 0, 0, 0)
    client.sendto(struct.pack("!HHI", 3, len(requested_transport), 0x2112A442) + transaction + requested_transport, target)
    try:
        response, _ = client.recvfrom(2048)
        assert response[8:20] == transaction and response[:2] == b"\x01\x13", "Unexpected Allocate response"
        print("Allocate refused (error response); no successful allocation")
    except socket.timeout:
        print("Allocate ignored (timeout); no successful allocation; verify active stun-only config separately")
