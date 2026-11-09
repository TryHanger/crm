import os
import datetime
import ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

def generate_staging_certificates(output_dir: str = "nginx/certs", force: bool = False):
    os.makedirs(output_dir, exist_ok=True)
    privkey_path = os.path.join(output_dir, "privkey.pem")
    cert_path = os.path.join(output_dir, "fullchain.pem")

    if not force and os.path.exists(privkey_path) and os.path.exists(cert_path):
        print(f"[+] Reusing existing TLS certificates in {output_dir}")
        return privkey_path, cert_path

    # Generate RSA private key (2048-bit)
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # Subject & Issuer
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "KZ"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Astana"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SaaS CRM Pilot Infrastructure"),
        x509.NameAttribute(NameOID.COMMON_NAME, "staging.crm.internal"),
    ])

    san_dns_names = [
        "localhost",
        "console.staging.crm.internal",
        "app.staging.crm.internal",
        "*.book.staging.crm.internal",
        "*.staging.crm.internal",
        "staging.crm.internal",
        "console.localhost",
        "app.localhost",
        "*.book.localhost",
        "*.localhost",
        "barberhouse.localhost",
        "moderncut.localhost",
        "proxy",
        "nginx",
    ]

    san_ips = [
        ipaddress.IPv4Address("127.0.0.1"),
        ipaddress.IPv6Address("::1"),
    ]

    san_list = [x509.DNSName(dns) for dns in san_dns_names] + [x509.IPAddress(ip) for ip in san_ips]

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName(san_list),
            critical=False,
        )
        .add_extension(
            x509.BasicConstraints(ca=True, path_length=None),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )

    with open(privkey_path, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))

    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"[+] TLS certificates successfully generated in {output_dir}:")
    print(f"    Private key: {privkey_path}")
    print(f"    Certificate: {cert_path}")
    print(f"    SANs: {', '.join(san_dns_names)}")

if __name__ == "__main__":
    generate_staging_certificates()
