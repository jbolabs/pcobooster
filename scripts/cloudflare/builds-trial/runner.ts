/** The Builds attachment is private and separate from every application Worker. */
export default {
  fetch() {
    return new Response("pcobooster isolated build trial", { status: 404 });
  },
};
