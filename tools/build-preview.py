#!/usr/bin/env python3
"""Render a local fixture preview of the real Tumblr template (not a Tumblr runtime)."""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = (ROOT / 'Tumblr.html').read_text()
DEFAULTS = dict(re.findall(r'<meta name="((?:text|color|if|select):[^"]+)" content="([^"]*)"', TEMPLATE))
# First select entry is the default, unlike dict's last-entry behavior.
for key, value in reversed(re.findall(r'<meta name="(select:[^"]+)" content="([^"]*)"', TEMPLATE)):
    DEFAULTS[key] = value
TAG = re.compile(r'{(/?)block:([A-Za-z][A-Za-z0-9]*)}', re.I)

def parse(source):
    root = []
    stack = [(None, root)]
    cursor = 0
    for tag in TAG.finditer(source):
        stack[-1][1].append(source[cursor:tag.start()])
        closing, name = tag.groups()
        if closing:
            if len(stack) == 1 or stack[-1][0].lower() != name.lower():
                raise ValueError('Unbalanced Tumblr block: ' + name)
            stack.pop()
        else:
            children = []
            stack[-1][1].append((name, children))
            stack.append((name, children))
        cursor = tag.end()
    stack[-1][1].append(source[cursor:])
    if len(stack) != 1:
        raise ValueError('Unclosed Tumblr block: ' + stack[-1][0])
    return root

TREE = parse(TEMPLATE)

def render(nodes, context):
    output = []
    for node in nodes:
        if isinstance(node, str):
            output.append(re.sub(r'{([^{}]+)}', lambda m: str(context.get(m[1], m[0])), node))
            continue
        name, children = node
        value = context.get('block:' + name, False)
        if name.startswith('IfNot') or name.startswith('If'):
            negated = name.startswith('IfNot')
            key = name[5:] if negated else name[2:]
            options = {re.sub(r'\s+', '', k.split(':', 1)[1]).lower(): v for k, v in DEFAULTS.items() if k.startswith(('text:', 'if:'))}
            setting = options.get(key.lower(), '')
            value = bool(setting and setting != '0')
            if negated:
                value = not value
        if isinstance(value, list):
            for item in value:
                output.append(render(children, context | item))
        elif value:
            output.append(render(children, context))
    return ''.join(output)

BASE = DEFAULTS | {
    'Title': 'مدونة ياسر الشهري', 'Description': 'الأدب في الغربة رفيق',
    'MetaDescription': 'خواطر وشعر ويوميات من بكين.', 'BlogURL': '/',
    'Favicon': 'data:,', 'RSS': '#', 'CopyrightYears': '2026',
    'CustomCSS': '', 'BackgroundColor': '#f7f4ec', 'AccentColor': '#e8b56e',
    'TitleColor': '#1b1a16', 'TitleFont': 'serif', 'TitleFontWeight': '500',
    'block:Description': True, 'block:AskEnabled': True,
    'block:SubmissionsEnabled': True, 'block:IfNotLogoImage': True,
}

def write(name, context):
    source = render(TREE, BASE | context)
    # Links stay in the fixture preview; native Tumblr routes are exercised by the installed theme.
    replacements = {'/': 'index.html', '/WhoAmI': 'about.html', '/random': 'permalink.html', '/archive': 'archive.html', '/ask': 'ask.html', '/submit': 'submit.html'}
    source = re.sub(r'href="([^"]+)"', lambda m: 'href="' + replacements.get(m[1], m[1]) + '"', source)
    current = name
    if current in ('index.html','about.html','archive.html','ask.html','submit.html'):
        source = source.replace('href="' + current + '">', 'href="' + current + '" aria-current="page">')
    # Expose unmapped theme variables, but ignore CSS braces and SVG placeholders.
    unresolved = re.findall(r'{(?:/?block:|text:|color:|select:)[A-Za-z][A-Za-z0-9 ]*}', source)
    if unresolved:
        raise ValueError('Unrendered variables: ' + repr(unresolved[:5]))
    (ROOT / 'preview' / name).write_text(source)

POSTS = json.loads((ROOT / 'preview' / 'fixtures.json').read_text())
for index, post in enumerate(POSTS):
    post.update({'block:Text': True, 'block:Title': bool(post.get('Title')), 'block:Date': True,
                 'PostID': str(index + 1), 'Permalink': 'permalink.html', 'Month': post.get('Month', 'October'),
                 'MonthNumber': post.get('MonthNumber', '10'), 'Year': '2026',
                 'LikeButton color="grey" size="20"': '<span aria-label="إعجاب">♡</span>',
                 'ReblogButton color="grey" size="20"': '<span aria-label="إعادة التدوين">↻</span>'})
write('index.html', {'block:IndexPage': True, 'block:Posts': POSTS, 'block:Pagination': True, 'block:NextPage': True, 'NextPage': 'page-2.html'})
write('page-2.html', {'block:IndexPage': True, 'block:Posts': POSTS[3:], 'block:Pagination': True, 'block:PreviousPage': True, 'PreviousPage': 'index.html'})
write('permalink.html', {'block:PermalinkPage': True, 'block:Posts': [POSTS[0]]})
about = (ROOT / 'preview' / 'about-body.html').read_text()
write('about.html', {'block:PermalinkPage': True, 'block:Posts': [{'block:Text': True, 'block:Title': True, 'Title': 'من أنا', 'Body': about, 'PostID': 'about'}]})
# Native Tumblr owns archive/ask/submit pages; these fixtures explain the local-preview limit.
for name, title in [('archive', 'الأرشيف'), ('ask', 'اسألني'), ('submit', 'أرسل')]:
    body = '<p>هذه معاينة محلية للتصميم. تعمل هذه الصفحة عبر نموذج Tumblr الرسمي بعد تركيب القالب.</p>'
    if name == 'archive':
        body = '<ul>' + ''.join('<li><a href="permalink.html">' + html.escape(p.get('Title') or 'تدوينة — ' + p['DayOfMonth']) + '</a></li>' for p in POSTS) + '</ul>'
    write(name + '.html', {'block:PermalinkPage': True, 'block:Posts': [{'block:Text': True, 'block:Title': True, 'Title': title, 'Body': body, 'PostID': name}]})
print('Rendered 7 previews from Tumblr.html; Tumblr blocks are balanced.')
