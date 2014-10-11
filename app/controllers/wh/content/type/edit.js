/*globals ga*/
import getItemModelName from 'appkit/utils/model';
import validateControls from 'appkit/utils/validators';
import dataFromControls from 'appkit/utils/controls';
import uuid from 'appkit/utils/uuid';
import SearchIndex from 'appkit/utils/search-index';
import slugger from 'appkit/utils/slugger';

export default Ember.ObjectController.extend({
  type        : null,
  lastUpdated : null,
  createDate  : null,
  isDraft     : null,
  publishDate : null,
  showSchedule: false,
  itemModel   : null,
  previewUrl  : null,
  initialRelations: Ember.Object.create(),
  initialValues: Ember.A([]),

  nameControl: null,
  slugControl: null,

  isEditingSlug: false,

  defaultSlug: null,

  fullPreviewUrl: function () {

    if(this.get('previewUrl') === null) {
      this.set('previewUrl', this.get('type.controls').findBy('name', 'preview_url').get('value'));
    }

    if(!this.get('previewUrl')) {
      return null;
    }

    return '/_wh_previews/' + this.get('type.id') + '/' + this.get('previewUrl') + '/';

  }.property('previewUrl'),

  isNameAndSlugValid: function () {
    return this.get('nameControl.widgetIsValid') && this.get('slugControl.widgetIsValid');
  }.property('nameControl.widgetIsValid', 'slugControl.widgetIsValid'),

  showSlug: function () {
    return !Ember.isEmpty(this.get('nameControl.value')) && !this.get('type.oneOff');
  }.property('nameControl.value', 'type.oneOff'),

  setDefaultSlug: function () {

    if (Ember.isEmpty(this.get('nameControl.value')) || Ember.isEmpty(this.get('type.id')) || !Ember.isEmpty(this.get('slugControl.value'))) {
      this.set('defaultSlug', null);
      return;
    }

    var slug = slugger({
      name: this.get('nameControl.value'),
      publish_date: (Ember.isEmpty(this.get('publishDate')) ? moment() : moment(this.get('publishDate'))).format()
    }, this.get('type.id'), this.get('type.customUrls'));

    this.set('defaultSlug', slug);

  }.observes('nameControl.value', 'type.id', 'slugControl.value'),

  isLive: function () {
    if (this.get('showSchedule')) {
      return false;
    }
    if (!this.get('publishDate') || this.get('isDraft')) {
      return false;
    }
    return moment(this.get('publishDate')).isBefore();
  }.property('publishDate', 'isDraft', 'showSchedule'),

  isScheduled: function () {
    if (this.get('showSchedule')) {
      return true;
    }
    if (!this.get('publishDate') || this.get('isDraft')) {
      return false;
    }
    return moment(this.get('publishDate')).isAfter();
  }.property('publishDate', 'isDraft', 'showSchedule'),

  isDirty: function () {

    var isDirty = false;

    this.get('controls').getEach('value').forEach(function (value, index) {
      if (!isDirty) {
        var initialValue = this.get('initialValues').objectAt(index);
        if ((value !== "" || initialValue !== undefined) && (value !== initialValue)) {
          isDirty = true;
        }
      }
    }.bind(this));

    return isDirty;

  }.property('controls.@each.value'),

  handleBeforeUnload: function () {
    return 'It looks like you have been editing something -- if you leave before submitting your changes will be lost.';
  },

  watchForUnload: function () {
    if (this.get('isDirty')) {
      Ember.Logger.info('Item is dirty, prevent navigation.');
      Ember.$(window).one('beforeunload', this.handleBeforeUnload);
    } else {
      Ember.Logger.info('Item is clean.');
      Ember.$(window).off('beforeunload', this.handleBeforeUnload);
    }
  }.observes('isDirty'),

  updateReverseRelationships: function (itemModel) {

    var controller = this;

    // Filter out relation controls that are related to their parent content type.
    var relationControls = controller.get('controls').filterBy('controlType.widget', 'relation');

    Ember.Logger.log('Updating %@ reverse relationships.'.fmt(relationControls.get('length')));

    relationControls.forEach(function (control) {

      var currentRelations = control.get('value') || Ember.A([]);
      var initialRelations = controller.get('initialRelations').get(control.get('name')) || Ember.A([]);

      // added relations is temporarily all values so that
      // var addedRelations = Ember.$(currentRelations).not(initialRelations).get();
      var addedRelations = currentRelations;
      var removedRelations = Ember.$(initialRelations).not(currentRelations).get();

      Ember.Logger.log('`%@` added %@ and removed %@ relationships'.fmt(control.get('name'), addedRelations.get('length'), removedRelations.get('length')));

      var updateRelation = function (relatedItem, updateType) {

        var contentTypeId = relatedItem.split(' ')[0];
        var itemId = relatedItem.split(' ')[1];
        var relatedValue = controller.get('type.id') + ' ' + itemModel.get('id');

        return controller.store.find('contentType', contentTypeId).then(function (contentType) {
          var modelName = getItemModelName(contentType);
          var foreignControls = contentType.get('controls');
          var reverseControl = control.get('meta.reverseName') && foreignControls.findBy('name', control.get('meta.reverseName'));

          // Legacy support
          // If we don't have a reverse relationship, add it.
          if (reverseControl) {

            Ember.Logger.log('Reverse control found for `%@` on `%@`, proceeding.'.fmt(control.get('name'), contentType.get('name')));

            return Ember.RSVP.Promise.resolve(contentType);

          } else {

            Ember.Logger.log('Reverse control NOT found for `%@` on `%@`, creating it.'.fmt(control.get('name'), contentType.get('name')));

            return controller.store.find('control-type', 'relation').then(function (controlType) {

              var reverseControl = controller.store.createRecord('control', {
                label: controller.get('type.name'),
                controlType: controlType,
                meta: Ember.Object.create({
                  contentTypeId: controller.get('type.id'),
                  reverseName: control.get('name')
                })
              });

              Ember.Logger.log('Setting new reverse control label to `%@`'.fmt(reverseControl.get('label')));

              // The new reverse relation control must have a unique name
              var counter = 1, counterName;
              while (foreignControls.getEach('name').indexOf(reverseControl.get('name')) >= 0) {
                counter = counter + 1;
                counterName = controller.get('type.name') + ' ' + counter;
                Ember.Logger.log('Duplicate control name detected, setting to `%@`'.fmt(counterName));
                reverseControl.set('label', counterName);
              }

              foreignControls.addObject(reverseControl);

              // update near side contentType relation control with reverse name.
              control.set('meta.reverseName', reverseControl.get('name'));
              return controller.get('type').save().then(function () {

                // update far side contentType relation control
                return contentType.save().then(function () {
                  Ember.Logger.log('Reverse relationship of `%@` to `%@` successfully added.'.fmt(control.get('name'), reverseControl.get('name')));
                  return Ember.RSVP.Promise.resolve(contentType);
                });

              });

            });

          }

        }).then(function (contentType) {

          // Find and update reverse item.
          return controller.store.find(getItemModelName(contentType), itemId).then(function (item) {

            var reverseName = control.get('meta.reverseName');
            var reverseControl = contentType.get('controls').findBy('name', reverseName);

            if (reverseControl.get('meta.isSingle')) {

              if (updateType === 'remove') {
                item.get('itemData')[reverseName] = null;
              } else {
                item.get('itemData')[reverseName] = relatedValue;
              }

            } else {

              var currentItems = item.get('itemData')[reverseName];

              if (Ember.isEmpty(currentItems)) {
                currentItems = Ember.A([]);
              }

              if (updateType === 'remove') {
                currentItems.removeObject(relatedValue);
              } else {
                currentItems.addObject(relatedValue);
              }

              item.get('itemData')[reverseName] = currentItems;

            }

            return item.save().then(function () {
              Ember.Logger.log('`%@` updated.'.fmt(item.get('itemData.name')));
            });

          });

        }, function (error) {

          Ember.Logger.error(error);

          if (window.trackJs) {
            window.trackJs.log("Attempted to save form.", itemModel);
            window.trackJs.track(error);
          }

          controller.send('notify', 'danger', 'Error saving relationship.');

        });

      };

      // Loop through removed relations, wait for each to process
      var removedRelationsCounter = 0;
      var removeRelation = function (item) {
        if (!item) {
          return;
        }
        updateRelation(item, 'remove').then(function () {
          removedRelationsCounter += 1;
          removeRelation(removedRelations.objectAt(removedRelationsCounter));
        });
      };
      removeRelation(removedRelations.objectAt(removedRelationsCounter));

      // Loop through added relations, wait for each to process
      var addedRelationsCounter = 0;
      var addRelation = function (item) {
        if (!item) {
          return;
        }
        updateRelation(item, 'add').then(function () {
          addedRelationsCounter += 1;
          addRelation(addedRelations.objectAt(addedRelationsCounter));
        });
      };
      addRelation(addedRelations.objectAt(addedRelationsCounter));

    });

  },

  saveItem: function () {

    ga('send', 'event', 'item', 'save');

    var controls = this.get('type.controls');

    // name field is special. it is validated as it changes.
    if (controls.findBy('name', 'name').get('widgetErrors.length')) {
      this.send('notify', 'danger', "Didn't save. Errors in form.");
      return;
    }

    // automatically update `update_date`
    controls.findBy('name', 'last_updated').set('value', moment().format('YYYY-MM-DDTHH:mm'));

    // sync publish date with controller
    controls.findBy('name', 'publish_date').set('value', this.get('publishDate'));

    // set create_date if missing
    if (!controls.findBy('name', 'create_date').get('value')) {
      controls.findBy('name', 'create_date').set('value', moment().format('YYYY-MM-DDTHH:mm'));
    }

    // set preview_url if missing
    if (!controls.findBy('name', 'preview_url').get('value')) {
      controls.findBy('name', 'preview_url').set('value', uuid());
      this.set('previewUrl', controls.findBy('name', 'preview_url').get('value'));
    }

    validateControls(this.get('type'), this.get('itemModel')).then(this.commitItem.bind(this));

  },

  commitItem: function () {

    var controls = this.get('type.controls');

    if (controls.isAny('widgetIsValid', false)) {
      this.send('notify', 'danger', "Didn't save. Errors in form.");
      return;
    }

    var itemData = dataFromControls(controls);

    itemData.isDraft = this.getWithDefault('isDraft', null);

    var itemModel = this.get('itemModel') || this.store.createRecord(getItemModelName(this.get('model')));

    this.updateReverseRelationships(itemModel);

    itemModel.set('itemData', itemData).save().then(function (item) {

      this.set('initialValues', controls.getEach('value'));

      window.ENV.sendBuildSignal(itemData.publish_date);

      SearchIndex.indexItem(item, this.get('type'));

      // One Off
      if (this.get('type.oneOff')) {
        this.send('notify', 'info', 'Saved. Initiating build.', {
          icon: 'ok-sign'
        });
      }

      // Draft
      else if (itemData.isDraft) {
        this.send('notify', 'info', 'Draft saved', {
          icon: 'ok-sign'
        });
      }

      // Live
      else if (itemData.publish_date && moment(itemData.publish_date).isBefore()) {
        this.send('notify', 'info', 'Saved. Initiating build.', {
          icon: 'ok-sign'
        });
      }

      // Future
      else {
        this.send('notify', 'info', 'Saved, will go live later', {
          icon: 'ok-sign'
        });
      }

      if (!this.get('itemModel')) {
        this.transitionToRoute('wh.content.type.edit', itemModel.get('id'));
      } else {

        // reset the initialRelations
        this.set('initialRelations', Ember.Object.create());
        this.get('type.controls').filterBy('controlType.widget', 'relation').forEach(function (control) {
          this.get('initialRelations').set(control.get('name'), Ember.copy(control.get('value')));
        }.bind(this));

      }

    }.bind(this), function (error) {
      Ember.Logger.error(error);
      if (window.trackJs) {
        window.trackJs.log("Attempted to save item.", itemModel);
        window.trackJs.track(error);
      }
      this.send('notify', 'danger', 'There was an error while saving.');
    }.bind(this));

  },

  actions: {
    saveItem: function () {
      this.saveItem();
    },

    saveDraft: function () {
      this.set('isDraft', true);
      this.set('publishDate', null);
      this.set('showSchedule', null);
      this.saveItem();
    },

    publishNow: function () {
      this.set('isDraft', null);
      this.set('publishDate', moment().format('YYYY-MM-DDTHH:mm'));
      this.saveItem();
    },

    publishFuture: function () {
      if (this.get('publishDate')) {
        this.set('isDraft', null);
        this.saveItem();
      } else {
        window.alert('Set a publish date');
      }
    },

    changePublishDate: function () {
      this.set('isDraft', null);
      this.set('publishDate', moment().format('YYYY-MM-DDTHH:mm'));
      this.set('showSchedule', true);
    },

    setPublishNow: function () {
      this.set('publishDate', moment().format('YYYY-MM-DDTHH:mm'));
    },

    removeTabularRow: function (row, control) {
      control.get('value').removeObject(row);
    },

    addTabularRow: function (control) {
      var emptyRow = Ember.A([]);
      control.get('meta.options').forEach(function () {
        emptyRow.pushObject(Ember.Object.create());
      });
      control.get('value').pushObject(emptyRow);
    },

    editSlug: function () {
      this.toggleProperty('isEditingSlug');
    },

    forceSlug: function () {
      if (Ember.isEmpty(this.get('slugControl.value'))) {
        this.setDefaultSlug();
      }
    }
  }
});
