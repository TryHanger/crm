import re

with open('готовый фронт.html', 'r', encoding='utf-8', errors='ignore') as f:
    html = f.read()

# Extract tabs / app views
# Look for data-app, data-screen, nav-item, sections
sections = re.findall(r'<section[^>]*id=[\"\']([^\"\']+)[\"\'][^>]*>', html)
buttons = re.findall(r'<button[^>]*>([^<]+)</button>', html)
inputs = re.findall(r'<input[^>]*name=[\"\']([^\"\']+)[\"\']', html)
modals = re.findall(r'<div[^>]*class=[\"\'][^\"\']*modal[^\"\']*[\"\'][^>]*id=[\"\']([^\"\']+)[\"\']', html)

print("Found sections:", len(sections), sections[:30])
print("Found inputs:", len(inputs), list(set(inputs))[:30])
print("Found modals:", len(modals), modals)

# Let's search for top-level headers / navigation
headers = re.findall(r'<h[1-4][^>]*>([^<]+)</h[1-4]>', html)
clean_headers = [h.strip() for h in headers if h.strip()]
print("Clean headers sample:", clean_headers[:40])
