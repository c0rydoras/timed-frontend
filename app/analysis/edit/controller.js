import Controller from '@ember/controller'
import { inject as service } from '@ember/service'
import { task } from 'ember-concurrency'
import { AnalysisQueryParams } from '../index/controller'
import { get } from '@ember/object'
import { dasherize, underscore } from '@ember/string'
import { cleanParams } from 'timed/utils/url'
import computed from 'ember-computed-decorators'
import { inject as controller } from '@ember/controller'

/* eslint-disable ember/avoid-leaking-state-in-ember-objects */
export const AnalysisEditQueryParams = AnalysisQueryParams.extend({
  id: {
    defaultValue: [],
    replace: true,
    refresh: true,
    serialize(arr) {
      return (arr && arr.join(',')) || ''
    },
    deserialize(str) {
      return (str && str.split(',')) || []
    }
  }
})
/* eslint-enable ember/avoid-leaking-state-in-ember-objects */

const prepareParams = params => {
  return cleanParams(
    Object.keys(params).reduce((parsed, key) => {
      let serialize = get(
        AnalysisEditQueryParams,
        `queryParams.${key}.serialize`
      )
      let value = get(params, key)

      return key === 'type'
        ? parsed
        : {
            ...parsed,
            [underscore(key)]: serialize ? serialize(value) : value
          }
    }, {})
  )
}

const filterUnchanged = (attributes, changes) => {
  return Object.keys(attributes).reduce((obj, attr) => {
    if (changes.map(({ key }) => dasherize(key)).includes(attr)) {
      return { ...obj, [attr]: attributes[attr] }
    }

    return { ...obj }
  }, {})
}

export default Controller.extend(AnalysisEditQueryParams.Mixin, {
  notify: service('notify'),
  ajax: service('ajax'),
  session: service('session'),
  analysisController: controller('analysis.index'),

  setup() {
    this.get('intersection').perform()
  },

  intersection: task(function*() {
    let res = yield this.get('ajax').request('/api/v1/reports/intersection', {
      method: 'GET',
      data: {
        ...prepareParams(this.get('allQueryParams')),
        include: 'task,project,customer'
      }
    })

    yield this.store.pushPayload('report-intersection', res)

    return {
      model: this.store.peekRecord('report-intersection', res.data.id),
      meta: res.meta
    }
  }),

  @computed('intersection.lastSuccessful.value.customer.id')
  _customer(id) {
    return id && this.store.peekRecord('customer', id)
  },

  @computed('intersection.lastSuccessful.value.project.id')
  _project(id) {
    return id && this.store.peekRecord('project', id)
  },

  @computed('intersection.lastSuccessful.value.task.id')
  _task(id) {
    return id && this.store.peekRecord('task', id)
  },

  save: task(function*(changeset) {
    try {
      let params = prepareParams(this.get('allQueryParams'))

      let queryString = Object.keys(params)
        .map(k => `${k}=${params[k]}`)
        .join('&')

      yield changeset.execute()

      let { data: { attributes, relationships } } = this.get(
        'intersection.lastSuccessful.value.model'
      ).serialize()

      let data = {
        type: 'report-bulks',
        attributes: filterUnchanged(attributes, changeset.get('changes')),
        relationships: filterUnchanged(relationships, changeset.get('changes'))
      }

      yield this.get(
        'ajax'
      ).request(`/api/v1/reports/bulk?editable=1&${queryString}`, {
        method: 'POST',
        data: { data }
      })

      this.get('analysisController')._reset()

      this.transitionToRoute('analysis.index', {
        queryParams: {
          ...this.get('allQueryParams')
        }
      })

      this.get('notify').success('Reports were saved')
    } catch (e) {
      /* istanbul ignore next */
      this.get('notify').error('Error while saving the reports')
    }
  }),

  actions: {
    cancel() {
      this.transitionToRoute('analysis.index', {
        queryParams: {
          ...this.get('allQueryParams')
        }
      })
    },

    reset(changeset) {
      changeset.rollback()
    }
  }
})
