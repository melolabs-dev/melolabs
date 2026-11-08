# Issue h3js/h3#1050: FR: Allow multiple unseal passwords for sessions

### Describe the feature

When rotating secrets for use as session passwords, we'd want to continue honoring prior sealed sessions.

For the `useSession` api, can we have an additional parameter: `extraUnsealPasswords` or something similar. Passwords to attempt are the default `password` and this `extraUnsealPasswords`.

Alternatively, we can have `password` as potentially being a non empty string array, with the first `password` being used for sealing, and the rest just for unsealing.

### Additional information

- [ ] Would you be willing to help implement this feature?
