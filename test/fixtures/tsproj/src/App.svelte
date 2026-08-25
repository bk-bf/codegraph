<script lang="ts">
  import { Greeter } from '$lib/services/Greeter';
  import { session } from '$lib/stores/session';

  const shown = new Greeter('world').greet(2);
</script>

<p>{shown} — {$session}</p>
