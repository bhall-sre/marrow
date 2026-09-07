const { DialogV2 } = foundry.applications.api;

/**
 * II: two of the four classes hand you a Stat adjustment and let you choose where it lands
 * -- the Scholar's "+5 to one Stat of your choice" and the Blighted's "-10 to one Stat of
 * your choice". Everything else about a class is fixed, so this dialog exists only to ask
 * that one question, and is skipped entirely for the Soldier and the Laborer.
 */
export class ClassChoiceDialog {
  /**
   * Apply a Class to an actor, asking for its choice first if it has one.
   * @param {Actor} actor
   * @param {Item} classItem
   */
  static async apply(actor, classItem) {
    const { amount, from } = classItem.system.choice;

    if (!amount) return classItem.applyClass(actor);

    const options = from.map(key => ({
      key,
      label: actor.system.stats[key]?.label ?? key,
      value: actor.system.stats[key]?.value ?? 0,
    }));

    const content = await foundry.applications.handlebars.renderTemplate(
      'systems/marrow/templates/dialog/class-choice.hbs',
      {
        classItem,
        amount,
        // A minus reads very differently from a plus here, and the player should see which
        // one they are being asked to place before they place it.
        isPenalty: amount < 0,
        options,
      },
    );

    const answer = await DialogV2.wait({
      window: { title: game.i18n.format('MARROW.Dialog.ClassTitle', { name: classItem.name }) },
      classes: ['marrow', 'dialog', 'class-choice'],
      content,
      buttons: [
        { action: 'apply', label: 'MARROW.Dialog.Apply', default: true, callback: (e, b) => new FormData(b.form).get('choice') },
        { action: 'cancel', label: 'MARROW.Dialog.Cancel' },
      ],
      rejectClose: false,
    });

    if (!answer || answer === 'cancel') return null;
    return classItem.applyClass(actor, { choice: answer });
  }
}
