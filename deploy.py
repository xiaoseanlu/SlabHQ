import base64, os

dest = '/Users/xlu02/Documents/Claude/Projects/SlabHQ/index.html'
b64_file = '/Users/xlu02/Documents/Claude/Projects/SlabHQ/slabhq_b64.txt'

if os.path.exists(b64_file):
    with open(b64_file) as f:
        b64 = f.read().strip()
    content = base64.b64decode(b64)
    with open(dest, 'wb') as f:
        f.write(content)
    print(f'✅ Saved {len(content):,} bytes to {dest}')
    os.remove(b64_file)
    os.remove(__file__)
    print('🗑  Cleaned up temp files')
else:
    print('❌ Base64 file not found. Run step 1 first.')
