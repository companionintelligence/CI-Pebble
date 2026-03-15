#
# This file is the default set of rules to compile a Pebble project.
#
import os.path

top = '.'
out = 'build'

def options(ctx):
    ctx.load('pebble_sdk')

def configure(ctx):
    ctx.load('pebble_sdk')

def build(ctx):
    ctx.load('pebble_sdk')

    build_worker = os.path.exists('worker_src')
    binaries = []

    cached_env = ctx.env
    for p in ctx.env.TARGET_PLATFORMS:
        ctx.set_env(ctx.all_envs[p])
        ctx.set_group(ctx.env.PLATFORM_NAME)
        app_elf = '{}/pebble-app.elf'.format(ctx.env.BUILD_DIR)
        ctx.pebble_app(
            source=ctx.path.ant_glob('src/**/*.c'),
            target=app_elf,
            bin_type='app',
            bin_name='pebble-app.bin',
            js=ctx.path.ant_glob(['src/js/**/*.js', 'src/js/**/*.json'])
        )

        if build_worker:
            worker_elf = '{}/pebble-worker.elf'.format(ctx.env.BUILD_DIR)
            binaries.append({'platform': p, 'app_elf': app_elf, 'worker_elf': worker_elf})
            ctx.pebble_worker(
                source=ctx.path.ant_glob('worker_src/**/*.c'),
                target=worker_elf,
                bin_type='worker',
                bin_name='pebble-worker.bin'
            )
        else:
            binaries.append({'platform': p, 'app_elf': app_elf})

    ctx.set_env(cached_env)
    ctx.set_group('bundle')
    ctx.pebble_bundle(
        binaries=binaries,
        js=ctx.path.ant_glob(['src/js/**/*.js', 'src/js/**/*.json'])
    )
